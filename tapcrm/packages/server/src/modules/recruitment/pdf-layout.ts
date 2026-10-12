/**
 * Reading order for PDF resumes.
 *
 * pdf.js returns text runs in content-stream order. For designed resumes
 * (sidebars, Word tables, Canva layouts) that order interleaves columns, so a
 * sidebar's "SKILLS" lands in the middle of a job entry. This module rebuilds
 * each page from geometry instead:
 *
 *   runs → lines (shared baseline) → segments (split at wide gaps)
 *        → recursive XY-cut, preferring real column gutters
 *
 * A vertical cut is refused when it would split rows apart — a right-aligned
 * date ("Engineer …… Jan 2021 – Present"), a label and its value, or a grid of
 * short skills — because there the two sides share baselines. Pieces of one
 * row are kept on one output line, separated by a tab.
 */

export interface PdfTextItem {
  readonly str: string;
  readonly hasEOL?: boolean;
  readonly transform?: readonly number[];
  readonly width?: number;
  readonly height?: number;
}

export interface LayoutLine {
  /** The line's text; pieces separated by a wide gap on the page are joined by a tab. */
  readonly text: string;
  /** Largest font size on the line, in points. */
  readonly size: number;
  /** 1-based page number. */
  readonly page: number;
  /** Distance of the baseline below the top of the page, in points. */
  readonly top: number;
  /** Left edge of the line, in points. */
  readonly left: number;
}

interface Run {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly size: number;
  readonly spaceBefore: boolean;
  readonly spaceAfter: boolean;
}

interface Segment {
  text: string;
  readonly x0: number;
  x1: number;
  readonly y: number;
  size: number;
}

/** "D E E P A K" — letter-spaced headings that pdf.js reports with a space between every glyph. */
const LETTER_SPACED = /^(?:\S ){2,}\S$/u;

/** A date or date range that is the whole segment: such text belongs to its row, not a column. */
const DATE_POINT = "(?:[a-z]{3,9}\\.?\\s*'?\\d{2,4}|\\d{1,2}\\s*[/.-]\\s*\\d{2,4}|(?:19|20)\\d{2}|present|current(?:ly)?|now|till\\s+date|to\\s+date|date|ongoing)";
const DATE_ONLY = new RegExp(`^\\(?${DATE_POINT}(?:\\s*(?:-|to|till|until|~)\\s*${DATE_POINT})?\\)?(?:\\s*\\([^)]{0,40}\\))?$`, 'iu');

/** Bounds the recursion on pathological pages. */
const MAX_DEPTH = 400;
/** Placed below any real page content. */
const ROTATED_TOP = 100_000;

function toRuns(items: readonly PdfTextItem[]): { runs: Run[]; rotated: string[] } {
  const runs: Run[] = [];
  const rotated: string[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const core = item.str.trim();
    if (!core) continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) continue;
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = transform;
    if (![a, b, c, d, x, y].every(Number.isFinite)) continue;
    const size = Math.hypot(c, d) || Math.abs(item.height ?? 0) || 10;
    // Vertical or rotated text (decorative side labels) cannot share lines with the rest.
    if (Math.abs(b) > Math.abs(a) * 0.2 || Math.abs(c) > Math.abs(d) * 0.2) {
      rotated.push(core);
      continue;
    }
    const text = LETTER_SPACED.test(core) ? core.replace(/ /g, '') : core;
    const width = item.width && item.width > 0 ? item.width : core.length * size * 0.5;
    runs.push({
      text,
      x,
      y,
      width,
      size,
      spaceBefore: /^\s/u.test(item.str),
      spaceAfter: /\s$/u.test(item.str),
    });
  }
  return { runs, rotated };
}

/** Some generators fake bold by drawing the same text twice, a fraction of a point apart. */
function withoutOverprint(runs: Run[]): Run[] {
  const kept: Run[] = [];
  for (const run of runs) {
    const duplicate = kept.slice(-6).some((previous) => previous.text === run.text
      && Math.abs(previous.x - run.x) < run.size * 0.3
      && Math.abs(previous.y - run.y) < run.size * 0.3);
    if (!duplicate) kept.push(run);
  }
  return kept;
}

function groupBaselines(runs: readonly Run[]): Run[][] {
  const lines: { y: number; size: number; runs: Run[] }[] = [];
  for (const run of runs) {
    let target: { y: number; size: number; runs: Run[] } | undefined;
    for (let index = lines.length - 1; index >= Math.max(0, lines.length - 4); index -= 1) {
      const line = lines[index]!;
      if (Math.abs(line.y - run.y) <= Math.min(line.size, run.size) * 0.4) {
        target = line;
        break;
      }
    }
    if (target) {
      target.runs.push(run);
      target.size = Math.max(target.size, run.size);
    } else {
      lines.push({ y: run.y, size: run.size, runs: [run] });
    }
  }
  return lines.map((line) => line.runs.sort((p, q) => p.x - q.x));
}

function toSegments(line: readonly Run[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let previous: Run | null = null;
  for (const run of line) {
    if (current && previous) {
      const gap = run.x - current.x1;
      const size = Math.max(Math.min(run.size, previous.size), 1);
      if (gap > Math.max(size * 1.5, 6)) {
        segments.push(current);
        current = null;
      } else {
        const spaced = previous.spaceAfter || run.spaceBefore || gap > size * 0.12;
        if (spaced && !current.text.endsWith(' ')) current.text += ' ';
        current.text += run.text;
        current.x1 = Math.max(current.x1, run.x + run.width);
        current.size = Math.max(current.size, run.size);
      }
    }
    if (!current) current = { text: run.text, x0: run.x, x1: run.x + run.width, y: run.y, size: run.size };
    previous = run;
  }
  if (current) segments.push(current);
  return segments;
}

function medianSize(segments: readonly Segment[]): number {
  const sizes = segments.map((segment) => segment.size).sort((p, q) => p - q);
  return sizes[Math.floor(sizes.length / 2)] ?? 10;
}

function sharesBaseline(segment: Segment, others: readonly Segment[]): boolean {
  return others.some((other) => Math.abs(other.y - segment.y) <= Math.min(other.size, segment.size) * 0.35);
}

/**
 * Two sides of a vertical gap are separate columns only when they flow
 * independently. Rows that merely have a wide gap — a date pushed to the right
 * margin, "Name : value", a grid of skills — share their baselines.
 */
function isColumnSplit(left: readonly Segment[], right: readonly Segment[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  if (right.every((segment) => DATE_ONLY.test(segment.text)) || left.every((segment) => DATE_ONLY.test(segment.text))) {
    return false;
  }
  const [small, large] = left.length <= right.length ? [left, right] : [right, left];
  const aligned = small.filter((segment) => sharesBaseline(segment, large)).length;
  return aligned / small.length < 0.6;
}

function verticalCut(segments: readonly Segment[]): { left: Segment[]; right: Segment[] } | null {
  if (segments.length < 2) return null;
  const sorted = [...segments].sort((p, q) => p.x0 - q.x0);
  const minimumGap = Math.max(10, medianSize(segments));
  const gaps: { start: number; end: number }[] = [];
  let reach = sorted[0]!.x1;
  for (const segment of sorted.slice(1)) {
    if (segment.x0 - reach >= minimumGap) gaps.push({ start: reach, end: segment.x0 });
    reach = Math.max(reach, segment.x1);
  }
  gaps.sort((p, q) => (q.end - q.start) - (p.end - p.start));
  for (const gap of gaps) {
    const left = segments.filter((segment) => segment.x1 <= gap.start + 0.01);
    const right = segments.filter((segment) => segment.x0 >= gap.end - 0.01);
    if (isColumnSplit(left, right)) return { left, right };
  }
  return null;
}

const ascent = (segment: Segment) => segment.y + segment.size * 0.75;
const descent = (segment: Segment) => segment.y - segment.size * 0.2;

/** The widest horizontal band of white space that no segment crosses. */
function horizontalCut(segments: readonly Segment[]): { above: Segment[]; below: Segment[] } | null {
  if (segments.length < 2) return null;
  const sorted = [...segments].sort((p, q) => ascent(q) - ascent(p));
  let floor = descent(sorted[0]!);
  let best: { gap: number; index: number } | null = null;
  for (let index = 1; index < sorted.length; index += 1) {
    const segment = sorted[index]!;
    const gap = floor - ascent(segment);
    if (gap > 0.01 && (!best || gap > best.gap)) best = { gap, index };
    floor = Math.min(floor, descent(segment));
  }
  if (!best) return null;
  return { above: sorted.slice(0, best.index), below: sorted.slice(best.index) };
}

/** Segments of one region as lines: top to bottom, left to right, pieces tab-separated. */
function regionLines(segments: readonly Segment[]): Segment[][] {
  const sorted = [...segments].sort((p, q) => q.y - p.y || p.x0 - q.x0);
  const lines: Segment[][] = [];
  for (const segment of sorted) {
    const line = lines.at(-1);
    const anchor = line?.[0];
    if (line && anchor && Math.abs(anchor.y - segment.y) <= Math.min(anchor.size, segment.size) * 0.4) line.push(segment);
    else lines.push([segment]);
  }
  return lines.map((line) => line.sort((p, q) => p.x0 - q.x0));
}

function readingOrder(segments: readonly Segment[], depth: number): Segment[][] {
  if (segments.length <= 1 || depth >= MAX_DEPTH) return regionLines(segments);
  const columns = verticalCut(segments);
  if (columns) return [...readingOrder(columns.left, depth + 1), ...readingOrder(columns.right, depth + 1)];
  const bands = horizontalCut(segments);
  if (bands) return [...readingOrder(bands.above, depth + 1), ...readingOrder(bands.below, depth + 1)];
  return regionLines(segments);
}

/**
 * One page of pdf.js text content as lines in reading order.
 * `pageTop` is the y coordinate of the top edge of the page.
 */
export function layoutPdfPage(items: readonly PdfTextItem[], page: number, pageTop: number): LayoutLine[] {
  const { runs, rotated } = toRuns(items);
  runs.sort((p, q) => q.y - p.y || p.x - q.x);
  const segments = groupBaselines(withoutOverprint(runs)).flatMap(toSegments);
  const lines: LayoutLine[] = readingOrder(segments, 0).map((line) => ({
    text: line.map((segment) => segment.text).join('\t'),
    size: Math.max(...line.map((segment) => segment.size)),
    page,
    top: Math.max(0, pageTop - (line[0]?.y ?? pageTop)),
    left: line[0]?.x0 ?? 0,
  }));
  // Rotated side labels go last so they never interrupt the page's text.
  for (const text of rotated) lines.push({ text, size: 0, page, top: ROTATED_TOP, left: 0 });
  return lines;
}
