import { knownHeading, type SectionKind } from './ats/text.js';

/**
 * Section names set in a left margin.
 *
 * Many templates put each section name in a narrow column on the left, level
 * with the first line of the section, and wrap a long name onto the next row:
 *
 *   EMPLOYMENT   Senior Security Officer | NPCIL, Mumbai
 *   HISTORY      Jul 2021 - Present
 *
 * Read row by row (pieces of a row are tab-separated), the name hides inside
 * content lines, so the parser never sees an "Employment History" heading and
 * misses the jobs, education and skills under it. Such rows are split: the
 * name becomes a heading line of its own, followed by the rest of each row.
 *
 * Only well-known section names count, never keyword guesses, so a job title
 * in capitals ("PROJECT MANAGER   Jan 2020 - Present") is left alone.
 */

export interface LayoutTextLine {
  readonly text: string;
}

/** Names that are clearly headings even when not in capitals ("Experience", "Skills:"). */
const PLAIN_CASE_SECTIONS: ReadonlySet<SectionKind> = new Set([
  'experience', 'education', 'skills', 'projects', 'certifications', 'summary',
]);

/** "EMPLOYMENT", "WORK HISTORY", "SKILLS & TOOLS": short and in capitals. */
function inCapitals(value: string): boolean {
  return value.length <= 32 && /^[A-Z][A-Z&/' -]*[A-Z]:?$/.test(value) && value.split(/\s+/).length <= 3;
}

/** "Employment History", "Work": every word capitalised, no digits. */
function inTitleCase(value: string): boolean {
  return value.length <= 40 && value.split(/\s+/).every((word) => /^(?:[A-Z][a-z'&/-]*:?|and|of|&)$/.test(word));
}

/** The section a margin label names, or null when the piece is ordinary content. */
function labelSection(value: string): SectionKind | null {
  const section = knownHeading(value);
  if (!section) return null;
  if (inCapitals(value) || value.endsWith(':')) return section;
  return PLAIN_CASE_SECTIONS.has(section) && inTitleCase(value) ? section : null;
}

/** First piece of a tab-separated row and the rest, or null for a single-piece line. */
function splitFirst(text: string): { readonly head: string; readonly rest: string } | null {
  const tab = text.indexOf('\t');
  if (tab <= 0) return null;
  const rest = text.slice(tab + 1).trim();
  return rest ? { head: text.slice(0, tab).trim(), rest } : null;
}

/** The two halves of a label wrapped onto two rows, in the same style. */
function sameStyle(first: string, second: string): boolean {
  return (inCapitals(first) && inCapitals(second)) || (inTitleCase(first) && inTitleCase(second));
}

export function splitMarginLabels<T extends LayoutTextLine>(lines: readonly T[]): T[] {
  const rows = [...lines];
  const out: T[] = [];
  const consumed = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    if (consumed.has(index)) continue;
    const line = rows[index]!;
    const cell = splitFirst(line.text);
    if (!cell) {
      out.push(line);
      continue;
    }

    // The label's second half: the first piece of the next row, or the whole
    // next line when nothing sits beside it.
    const next = rows[index + 1];
    const nextCell = next ? splitFirst(next.text) : null;
    const nextHead = nextCell?.head ?? next?.text.trim() ?? '';
    const wrapped = nextHead && sameStyle(cell.head, nextHead) && knownHeading(`${cell.head} ${nextHead}`)
      ? `${cell.head} ${nextHead}`
      : null;

    let label = wrapped ?? (labelSection(cell.head) ? cell.head : null);
    if (!label) {
      out.push(line);
      continue;
    }

    // "WORK" on a line of its own, then "EXPERIENCE   Senior Engineer…".
    const previous = out.at(-1);
    const previousText = previous?.text.trim() ?? '';
    if (previous && !wrapped && sameStyle(previousText, label) && knownHeading(`${previousText} ${label}`)) {
      out.pop();
      label = `${previousText} ${label}`;
    }

    out.push({ ...line, text: label.replace(/:$/, '') }, { ...line, text: cell.rest });
    if (wrapped && next) {
      if (nextCell) rows[index + 1] = { ...next, text: nextCell.rest };
      else consumed.add(index + 1);
    }
  }
  return out;
}
