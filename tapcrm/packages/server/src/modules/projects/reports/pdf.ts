/**
 * Project Performance Report — PDF generator
 * ---------------------------------------------------------------------------
 * Builds the "Project Performance Report" for a single project.
 *
 *   Cover               – identity band, project title, project facts, key
 *                         figures and a contents list with real page numbers
 *   01 Keyword Analysis – summary, key figures, ranking chart, keyword table
 *   02 Blog Updates     – summary, key figure, blog register
 *   03 Off-page SEO     – summary, key figures, source split, daily trend,
 *                         backlink register
 *   04 Screenshots      – summary, key figure, screenshot grid
 *
 * Design language (deliberately restrained, like a printed management report)
 *   · White pages, one navy + one orange accent, green / red used ONLY for
 *     rank movement and status.
 *   · Serif (Times) for titles and big numbers, Helvetica for data.
 *   · Hairline rules instead of boxes, no icons, no pills, no decorative shapes.
 *   · Each section opens with a plain-language summary derived from the data.
 *
 * Long tables / registers continue on extra pages automatically. Running
 * headers, "Page X of Y" footers and the contents page numbers are drawn at the
 * very end, once the final page count is known.
 *
 * Public API (unchanged):
 *     createProjectReportPdf(ctx, projectId): Promise<Buffer>
 *
 * File layout
 *   1. Imports & design tokens
 *   2. Types
 *   3. Formatting helpers
 *   4. Data loading (backend calls — unchanged)
 *   5. Drawing primitives (text, rules, KPI row, tables, charts)
 *   6. Page builders (cover, contents, 4 sections)
 *   7. Document assembly & public export
 */

import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestContext } from '../../../platform/dal/context.js';
import { findProjectById } from '../repository.js';
import { ProjectNotFoundError } from '../errors.js';
import { listBacklinks, backlinkListSchema, type Backlink } from './off-page.js';
import {
  downloadScreenshot,
  listScreenshots,
  screenshotListSchema,
  type Screenshot,
} from './screenshots.js';
import { listBlogs, listKeywords, overview, type ReportContext } from './repository.js';
import type { ReportQuery } from './validators.js';

/* ========================================================================== */
/* 1. DESIGN TOKENS                                                           */
/* ========================================================================== */

/** Palette: navy is the voice, orange is a rare accent, the rest is grey. */
const COLORS = {
  ink: '#1c2530',
  navy: '#14284b',
  slate: '#5b6776',
  grey: '#8a94a3',
  accent: '#e87525',
  green: '#1f7a4d',
  red: '#b8433f',
  rule: '#cfd6de',
  ruleSoft: '#e5e9ee',
  wash: '#f4f6f8',
  white: '#ffffff',
  link: '#2c5aa0',
  onNavy: '#c9d5e8',
} as const;

/** Chart series colours (restrained: navy, accent, two neutrals). */
const SERIES = ['#14284b', '#e87525', '#5b82b8', '#8b95a3'] as const;

/** Typography — PDFKit built-in fonts only, so no font files are required. */
const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  serif: 'Times-Roman',
  serifBold: 'Times-Bold',
} as const;

/** Page geometry (A4, points). */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** Content must stay above this line so it never collides with the footer. */
const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN - 30;

/* ========================================================================== */
/* 2. TYPES                                                                   */
/* ========================================================================== */

type Keyword = Awaited<ReturnType<typeof listKeywords>>['items'][number];
type Blog = Awaited<ReturnType<typeof listBlogs>>['items'][number];
type Doc = PDFKit.PDFDocument;

interface ReportData {
  project: NonNullable<Awaited<ReturnType<typeof findProjectById>>>;
  keywords: Keyword[];
  blogs: Blog[];
  backlinks: Backlink[];
  screenshots: Array<{ item: Screenshot; body: Buffer }>;
  summary: Awaited<ReturnType<typeof overview>>;
  logo: Buffer | null;
}

/** One figure in a KPI row. */
interface Kpi {
  label: string;
  value: number | string;
  /** Optional small line under the number. */
  note?: string;
  /** Optional semantic colour for the number (defaults to navy). */
  color?: string;
}

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/** Entry for the contents list; the page number is recorded while building. */
interface TocEntry {
  title: string;
  description: string;
  page: number;
}

/* ========================================================================== */
/* 3. FORMATTING HELPERS                                                      */
/* ========================================================================== */

/** Formats a date as "12 Oct 2026"; returns an em dash for empty values. */
function date(value: Date | string | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value))
    : '—';
}

/** Short "12 Oct" label used on chart axes. */
function shortDate(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(
    value,
  );
}

/** Collapses whitespace and guarantees a printable string. */
function safeText(value: unknown): string {
  const text =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
  return text.replace(/\s+/g, ' ').trim() || '—';
}

/** "social_media" → "Social media". */
function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Full blog lifecycle label shown in the report register. */
function blogStatusLabel(status: string): string {
  if (status === 'published') return 'Published';
  if (status === 'draft') return 'Draft';
  if (status === 'archived') return 'Archived';
  return humanize(status);
}

/** "1 keyword" / "2 keywords". */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Percentage of `part` in `total`, rounded, 0 when total is 0. */
function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

/** Latest of a list of dates, or null. */
function latestOf(values: Array<Date | string | null | undefined>): Date | null {
  const times = values
    .filter((value): value is Date | string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Rank history for one keyword as [past, previous, current]. */
function rankSeries(item: Keyword): [number, number, number] {
  const past = item.pastRank ?? 0;
  const previous = item.previousRank ?? 0;
  const current = item.currentRank ?? 0;
  return [past, previous, current];
}

/* ========================================================================== */
/* 4. DATA LOADING (BACKEND CALLS — UNCHANGED)                                */
/* ========================================================================== */

/** Fetches every page of keywords for the project. */
async function allKeywords(ctx: ReportContext, query: ReportQuery): Promise<Keyword[]> {
  const first = await listKeywords(ctx, { ...query, keywordPage: 1 });
  const extraPages = Math.max(0, Math.ceil(first.total / first.pageSize) - 1);
  const pages = await Promise.all(
    Array.from({ length: extraPages }, (_, index) =>
      listKeywords(ctx, { ...query, keywordPage: index + 2 }),
    ),
  );
  return [first, ...pages].flatMap((page) => page.items);
}

/** Fetches every page of blog updates for the project. */
async function allBlogs(ctx: ReportContext, query: ReportQuery): Promise<Blog[]> {
  const first = await listBlogs(ctx, { ...query, blogPage: 1 });
  const extraPages = Math.max(0, Math.ceil(first.total / first.pageSize) - 1);
  const pages = await Promise.all(
    Array.from({ length: extraPages }, (_, index) =>
      listBlogs(ctx, { ...query, blogPage: index + 2 }),
    ),
  );
  return [first, ...pages].flatMap((page) => page.items);
}

/** Fetches every page of backlinks (100 per page). */
async function allBacklinks(ctx: RequestContext, projectId: string): Promise<Backlink[]> {
  const first = await listBacklinks(
    ctx,
    projectId,
    backlinkListSchema.parse({ page: 1, pageSize: 100 }),
  );
  const pages = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      listBacklinks(
        ctx,
        projectId,
        backlinkListSchema.parse({ page: index + 2, pageSize: 100 }),
      ),
    ),
  );
  return [first, ...pages].flatMap((page) => page.items);
}

/**
 * Loads everything the report needs in parallel. Screenshots are downloaded
 * and WebP images are converted to PNG (PDFKit only supports PNG/JPEG).
 * A screenshot that fails to download is skipped rather than failing the report.
 */
async function loadData(ctx: RequestContext, projectId: string): Promise<ReportData> {
  const project = await findProjectById(ctx, projectId);
  if (!project) throw new ProjectNotFoundError();

  const reportContext = { ...ctx, projectId } as ReportContext;
  const query: ReportQuery = {
    period: 90,
    keywordCategory: 'all',
    keywordPriority: 'all',
    keywordDevice: 'all',
    keywordTrend: 'all',
    blogStatus: 'all',
    keywordPage: 1,
    blogPage: 1,
  };

  const [keywords, blogs, backlinks, screenshotsPage, summary] = await Promise.all([
    allKeywords(reportContext, query),
    allBlogs(reportContext, query),
    allBacklinks(ctx, projectId),
    listScreenshots(
      ctx,
      projectId,
      screenshotListSchema.parse({ page: 1, pageSize: 50, period: 90 }),
    ),
    overview(reportContext),
  ]);

  const screenshots = (
    await Promise.all(
      screenshotsPage.items.map(async (item) => {
        try {
          const content = await downloadScreenshot(ctx, projectId, item.id);
          const body =
            content.mimeType === 'image/webp'
              ? await sharp(content.body).png().toBuffer()
              : content.body;
          return { item, body };
        } catch {
          return null;
        }
      }),
    )
  ).filter((entry): entry is { item: Screenshot; body: Buffer } => entry !== null);

  // The server can run from the monorepo root in development or from the
  // server workspace in another deployment. Resolve the client-owned logo
  // from both working-directory layouts without copying the asset.
  const logoPaths = [
    join(process.cwd(), 'packages/client/public/brand/tapvera-crm.png'),
    join(process.cwd(), '../client/public/brand/tapvera-crm.png'),
    join(process.cwd(), '../../packages/client/public/brand/tapvera-crm.png'),
  ];
  let logo: Buffer | null = null;
  for (const logoPath of logoPaths) {
    try {
      logo = await readFile(logoPath);
      break;
    } catch {
      // Try the next known workspace layout.
    }
  }
  return { project, keywords, blogs, backlinks, screenshots, summary, logo };
}

/* ========================================================================== */
/* 5. DRAWING PRIMITIVES                                                      */
/* ========================================================================== */

/* ----- 5.1 Text & rules --------------------------------------------------- */

/** Single-line text with ellipsis; never wraps and never triggers a page break. */
function line(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: {
    font?: string;
    size?: number;
    color?: string;
    align?: 'left' | 'center' | 'right';
    link?: string;
    underline?: boolean;
    spacing?: number;
  } = {},
): void {
  const size = opts.size ?? 9;
  doc
    .font(opts.font ?? FONT.regular)
    .fontSize(size)
    .fillColor(opts.color ?? COLORS.ink)
    .text(safeText(text), x, y, {
      width,
      height: size + 3,
      ellipsis: true,
      lineBreak: false,
      align: opts.align ?? 'left',
      link: opts.link,
      underline: opts.underline,
      characterSpacing: opts.spacing,
    });
}

/** Wrapped paragraph; returns the height it occupies. Use only near page tops. */
function paragraph(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { font?: string; size?: number; color?: string; lineGap?: number } = {},
): number {
  doc
    .font(opts.font ?? FONT.regular)
    .fontSize(opts.size ?? 9.5)
    .fillColor(opts.color ?? COLORS.ink);
  const options = { width, lineGap: opts.lineGap ?? 2.5 };
  const height = doc.heightOfString(text, options);
  doc.text(text, x, y, options);
  return height;
}

/** Small uppercase label (for table headers, KPI labels, field labels). */
function caption(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'right' | 'center' = 'left',
): void {
  line(doc, text.toUpperCase(), x, y, width, {
    font: FONT.bold,
    size: 6.8,
    color: COLORS.slate,
    spacing: 0.7,
    align,
  });
}

/** Horizontal rule. */
function rule(
  doc: Doc,
  y: number,
  color: string = COLORS.rule,
  weight = 0.5,
  x1 = MARGIN,
  x2 = PAGE_WIDTH - MARGIN,
): void {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(weight).strokeColor(color).stroke();
}

/** Label above a value with a hairline beneath — used for project facts. */
function field(
  doc: Doc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): void {
  caption(doc, label, x, y, width);
  line(doc, value, x, y + 12, width, { font: FONT.bold, size: 10.5, color: COLORS.ink });
  rule(doc, y + 32, COLORS.ruleSoft, 0.6, x, x + width);
}

/* ----- 5.2 KPI row -------------------------------------------------------- */

/**
 * Row of key figures separated by vertical hairlines under a heavy navy rule —
 * the way figures are shown in a printed management report. Advances `doc.y`.
 */
function kpiRow(doc: Doc, items: Kpi[]): void {
  const y = doc.y;
  const height = 70;
  const columnWidth = CONTENT_WIDTH / items.length;
  rule(doc, y, COLORS.navy, 1.6);
  items.forEach((item, index) => {
    const x = MARGIN + index * columnWidth;
    const pad = index === 0 ? 0 : 16;
    if (index > 0)
      doc
        .moveTo(x, y + 10)
        .lineTo(x, y + height - 6)
        .lineWidth(0.5)
        .strokeColor(COLORS.rule)
        .stroke();
    caption(doc, item.label, x + pad, y + 12, columnWidth - pad - 8);
    line(doc, String(item.value), x + pad, y + 24, columnWidth - pad - 8, {
      font: FONT.serifBold,
      size: 27,
      color: item.color ?? COLORS.navy,
    });
    if (item.note)
      line(doc, item.note, x + pad, y + 56, columnWidth - pad - 8, {
        size: 7,
        color: COLORS.grey,
      });
  });
  rule(doc, y + height, COLORS.rule, 0.5);
  doc.y = y + height + 22;
}

/** Heading for a sub-block (chart / table) inside a section. */
function blockHeading(doc: Doc, title: string, note?: string): void {
  line(doc, title, MARGIN, doc.y, CONTENT_WIDTH * 0.6, {
    font: FONT.bold,
    size: 10.5,
    color: COLORS.navy,
  });
  if (note)
    line(doc, note, MARGIN + CONTENT_WIDTH * 0.5, doc.y + 2, CONTENT_WIDTH * 0.5, {
      size: 7.5,
      color: COLORS.grey,
      align: 'right',
    });
  doc.y += 18;
}

/* ----- 5.3 Page scaffolding ---------------------------------------------- */

/**
 * Starts a section page: small numbered kicker, serif title, subtitle, rule and
 * a plain-language summary. Records the page number for the contents list.
 */
function sectionPage(
  doc: Doc,
  toc: TocEntry[],
  config: {
    number: number;
    kicker: string;
    title: string;
    subtitle: string;
    summary: string;
  },
): void {
  doc.addPage({ size: 'A4', margin: MARGIN });
  toc.push({
    title: config.title,
    description: config.subtitle,
    page: doc.bufferedPageRange().count,
  });

  const top = MARGIN + 4;
  line(
    doc,
    `${String(config.number).padStart(2, '0')}   ${config.kicker.toUpperCase()}`,
    MARGIN,
    top,
    CONTENT_WIDTH,
    { font: FONT.bold, size: 7.5, color: COLORS.accent, spacing: 1.6 },
  );
  line(doc, config.title, MARGIN, top + 16, CONTENT_WIDTH, {
    font: FONT.serifBold,
    size: 26,
    color: COLORS.navy,
  });
  line(doc, config.subtitle, MARGIN, top + 50, CONTENT_WIDTH, {
    size: 9,
    color: COLORS.slate,
  });
  rule(doc, top + 70, COLORS.navy, 1);

  const height = paragraph(doc, config.summary, MARGIN, top + 84, CONTENT_WIDTH, {
    size: 10,
    color: COLORS.ink,
    lineGap: 3,
  });
  doc.y = top + 84 + height + 20;
}

/** Compact heading for a continuation page of a long section. */
function continuationPage(doc: Doc, title: string): void {
  doc.addPage({ size: 'A4', margin: MARGIN });
  line(doc, title, MARGIN, MARGIN, CONTENT_WIDTH - 90, {
    font: FONT.serifBold,
    size: 16,
    color: COLORS.navy,
  });
  line(doc, 'continued', PAGE_WIDTH - MARGIN - 80, MARGIN + 5, 80, {
    font: FONT.italic,
    size: 8,
    color: COLORS.grey,
    align: 'right',
  });
  rule(doc, MARGIN + 26, COLORS.navy, 0.8);
  doc.y = MARGIN + 42;
}

/** Starts a continuation page if `required` points do not fit. */
function ensureSpace(doc: Doc, required: number, title: string): boolean {
  if (doc.y + required > CONTENT_BOTTOM) {
    continuationPage(doc, title);
    return true;
  }
  return false;
}

/** Draws the same Tapvera CRM artwork used by the application sidebar. */
function drawBrandLogo(
  doc: Doc,
  logo: Buffer | null,
  x: number,
  y: number,
  fit: [number, number],
): boolean {
  if (!logo) return false;
  try {
    doc.image(logo, x, y, { fit });
    return true;
  } catch {
    return false;
  }
}

/**
 * Draws running headers and "Page X of Y" footers on every page. Runs once all
 * pages exist so the page count is correct. The bottom margin is zeroed while
 * drawing so PDFKit can never auto-insert a page for the footer.
 */
function pageChrome(doc: Doc, projectName: string, logo: Buffer | null): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const isCover = index === range.start;
    const footerY = PAGE_HEIGHT - MARGIN + 2;
    const previousBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();

    if (!isCover) {
      if (!drawBrandLogo(doc, logo, MARGIN, 17, [96, 18]))
        line(doc, 'TAPVERA CRM', MARGIN, 22, 120, {
          font: FONT.bold,
          size: 7,
          color: COLORS.navy,
          spacing: 1.2,
        });
      line(
        doc,
        `${projectName}  ·  Project Performance Report`,
        PAGE_WIDTH - MARGIN - 320,
        22,
        320,
        { size: 7, color: COLORS.grey, align: 'right' },
      );
      rule(doc, 34, COLORS.ruleSoft, 0.6);
    }

    rule(doc, footerY - 8, COLORS.rule, 0.5);
    line(doc, 'Tapvera CRM  ·  Confidential', MARGIN, footerY, 260, {
      size: 7,
      color: COLORS.grey,
    });
    line(
      doc,
      `Page ${index - range.start + 1} of ${range.count}`,
      PAGE_WIDTH - MARGIN - 90,
      footerY,
      90,
      { font: FONT.bold, size: 7, color: COLORS.slate, align: 'right' },
    );

    doc.restore();
    doc.page.margins.bottom = previousBottom;
  }
}

/* ----- 5.4 Table ---------------------------------------------------------- */

/** Draws the table header and returns the Y where the first row starts. */
function tableHeader(doc: Doc, columns: Column[], y: number): number {
  let x = MARGIN;
  for (const column of columns) {
    caption(doc, column.label, x + 6, y + 6, column.width - 12, column.align ?? 'left');
    x += column.width;
  }
  rule(doc, y + 20, COLORS.navy, 0.9);
  doc.y = y + 20;
  return y + 20;
}

/** Left X of every column. */
function columnOffsets(columns: Column[]): number[] {
  let x = MARGIN;
  return columns.map((column) => {
    const start = x;
    x += column.width;
    return start;
  });
}

/** Draws a text cell inside column `index` of a row. */
function cell(
  doc: Doc,
  columns: Column[],
  xs: number[],
  index: number,
  text: string,
  y: number,
  opts: Parameters<typeof line>[5] = {},
): void {
  const column = columns[index];
  if (!column) return;
  line(doc, text, (xs[index] ?? MARGIN) + 6, y, column.width - 12, {
    align: column.align ?? 'left',
    ...opts,
  });
}

/**
 * Paginated register: hairline-separated rows, repeated header on every page.
 * `renderRow` receives the row, its index, the row's top Y and column offsets.
 */
function drawTable<T>(
  doc: Doc,
  config: {
    title: string;
    columns: Column[];
    rows: T[];
    rowHeight: number;
    empty: string;
    renderRow: (row: T, index: number, y: number, xs: number[]) => void;
  },
): void {
  const { columns, rows, rowHeight } = config;
  const xs = columnOffsets(columns);

  // Keep the header together with at least the first row.
  ensureSpace(doc, 20 + rowHeight + 4, config.title);
  let y = tableHeader(doc, columns, doc.y);

  if (!rows.length) {
    line(doc, config.empty, MARGIN + 6, y + 12, CONTENT_WIDTH - 12, {
      size: 9,
      color: COLORS.grey,
    });
    rule(doc, y + 34, COLORS.rule, 0.5);
    doc.y = y + 44;
    return;
  }

  rows.forEach((row, index) => {
    if (ensureSpace(doc, rowHeight, config.title)) y = tableHeader(doc, columns, doc.y);
    config.renderRow(row, index, y, xs);
    rule(doc, y + rowHeight, COLORS.ruleSoft, 0.6);
    y += rowHeight;
    doc.y = y;
  });
  doc.y = y + 12;
}

/** Small direction mark for rank movement (drawn as a shape, not a glyph). */
function trendMark(
  doc: Doc,
  kind: 'up' | 'down' | 'flat',
  cx: number,
  cy: number,
  color: string,
): void {
  doc.save().fillColor(color);
  if (kind === 'up')
    doc.polygon([cx - 3.6, cy + 2.8], [cx + 3.6, cy + 2.8], [cx, cy - 3.4]).fill();
  else if (kind === 'down')
    doc.polygon([cx - 3.6, cy - 2.8], [cx + 3.6, cy - 2.8], [cx, cy + 3.4]).fill();
  else doc.rect(cx - 3.6, cy - 0.7, 7.2, 1.4).fill();
  doc.restore();
}

/* ----- 5.5 Charts --------------------------------------------------------- */

/** Title block for a chart panel: heavy rule, bold title, small caption. */
function panelTitle(
  doc: Doc,
  title: string,
  note: string,
  x: number,
  y: number,
  width: number,
): void {
  rule(doc, y, COLORS.navy, 1.2, x, x + width);
  line(doc, title, x, y + 9, width, { font: FONT.bold, size: 9.5, color: COLORS.navy });
  line(doc, note, x, y + 22, width, { size: 7, color: COLORS.grey });
}

/**
 * Ranking movement for up to four keywords across Past → Previous → Current.
 * A lower rank number is a better position, so the axis starts at 0 on top and
 * improving keywords climb upward.
 */
function keywordTrendChart(doc: Doc, keywords: Keyword[]): void {
  const height = 190;
  const y = doc.y;
  panelTitle(
    doc,
    'Ranking movement',
    'Rank position, lower is better  ·  first four tracked keywords',
    MARGIN,
    y,
    CONTENT_WIDTH,
  );

  const plotted = keywords.filter((item) => item.pastRank !== null || item.previousRank !== null || item.currentRank !== null).slice(0, 4);
  const plotLeft = MARGIN + 34;
  const plotRight = PAGE_WIDTH - MARGIN - 34;
  const plotTop = y + 56;
  const plotHeight = 98;
  const plotWidth = plotRight - plotLeft;

  const peak = Math.max(20, ...plotted.flatMap((item) => rankSeries(item)));
  const maxRank = Math.ceil((peak + 5) / 20) * 20;

  // Grid + y-axis labels.
  for (let step = 0; step <= 4; step += 1) {
    const gridY = plotTop + (plotHeight * step) / 4;
    rule(
      doc,
      gridY,
      step === 4 ? COLORS.rule : COLORS.ruleSoft,
      0.5,
      plotLeft,
      plotRight,
    );
    line(doc, String(Math.round((maxRank * step) / 4)), MARGIN, gridY - 3, 26, {
      size: 6.5,
      color: COLORS.grey,
      align: 'right',
    });
  }
  // X-axis labels.
  ['Past', 'Previous', 'Current'].forEach((label, index) => {
    const x = plotLeft + (plotWidth * index) / 2;
    line(doc, label, x - 30, plotTop + plotHeight + 8, 60, {
      size: 7,
      color: COLORS.slate,
      align: 'center',
    });
  });

  if (!plotted.length) {
    line(
      doc,
      'Not enough rank observations to draw a trend.',
      plotLeft,
      plotTop + 40,
      plotWidth,
      { size: 8.5, color: COLORS.grey, align: 'center' },
    );
    doc.y = y + height + 14;
    return;
  }

  // Legend (top right, right-aligned squares + labels).
  let legendX = PAGE_WIDTH - MARGIN;
  [...plotted].reverse().forEach((item, reversedIndex) => {
    const itemIndex = plotted.length - 1 - reversedIndex;
    const color = SERIES[itemIndex] ?? SERIES[0];
    const label = safeText(item.keyword);
    const labelWidth = Math.min(
      90,
      doc.font(FONT.regular).fontSize(7.5).widthOfString(label) + 2,
    );
    legendX -= labelWidth;
    line(doc, label, legendX, y + 10, labelWidth, { size: 7.5, color: COLORS.slate });
    legendX -= 11;
    doc
      .rect(legendX, y + 11, 7, 7)
      .fillColor(color)
      .fill();
    legendX -= 14;
  });

  // Series lines, markers and end-point values.
  plotted.forEach((item, itemIndex) => {
    const color = SERIES[itemIndex] ?? SERIES[0];
    const values = rankSeries(item);
    const coords = values.map((value, index) => ({
      x: plotLeft + (plotWidth * index) / 2,
      y: plotTop + (plotHeight * value) / maxRank,
    }));
    doc.lineWidth(1.6).lineJoin('round').strokeColor(color);
    coords.forEach((point, index) => {
      const previous = coords[index - 1];
      if (previous) doc.moveTo(previous.x, previous.y).lineTo(point.x, point.y).stroke();
    });
    coords.forEach((point) => doc.circle(point.x, point.y, 2.4).fillColor(color).fill());
    const last = coords[coords.length - 1];
    if (last)
      line(doc, String(values[2]), last.x + 7, last.y - 4, 26, {
        font: FONT.bold,
        size: 7.5,
        color,
      });
  });

  doc.y = y + height + 14;
}

/** Source split (stacked bar) and daily additions (bar chart), side by side. */
function backlinkCharts(doc: Doc, backlinks: Backlink[]): void {
  const y = doc.y;
  const gap = 28;
  const width = (CONTENT_WIDTH - gap) / 2;
  const height = 150;
  const total = backlinks.length;
  const social = backlinks.filter((item) => item.category === 'social_media').length;
  const others = total - social;

  /* --- Left: source distribution ------------------------------------- */
  panelTitle(doc, 'Source distribution', 'Share of recorded backlinks', MARGIN, y, width);
  const barY = y + 44;
  doc.rect(MARGIN, barY, width, 14).fillColor(COLORS.wash).fill();
  if (total) {
    const socialWidth = (social / total) * width;
    doc.rect(MARGIN, barY, socialWidth, 14).fillColor(SERIES[0]).fill();
    doc
      .rect(MARGIN + socialWidth, barY, width - socialWidth, 14)
      .fillColor('#a9b8cc')
      .fill();
  }
  caption(doc, 'Source', MARGIN, y + 76, width * 0.5);
  caption(doc, 'Count', MARGIN + width - 90, y + 76, 40, 'right');
  caption(doc, 'Share', MARGIN + width - 40, y + 76, 40, 'right');
  rule(doc, y + 90, COLORS.rule, 0.5, MARGIN, MARGIN + width);
  [
    { label: 'Social media', count: social, color: SERIES[0] as string },
    { label: 'Other sources', count: others, color: '#a9b8cc' },
  ].forEach((entry, index) => {
    const rowY = y + 98 + index * 22;
    doc
      .rect(MARGIN, rowY + 1, 8, 8)
      .fillColor(entry.color)
      .fill();
    line(doc, entry.label, MARGIN + 16, rowY, width * 0.5, { size: 8.5 });
    line(doc, String(entry.count), MARGIN + width - 90, rowY, 40, {
      font: FONT.bold,
      size: 8.5,
      align: 'right',
    });
    line(doc, `${percent(entry.count, total)}%`, MARGIN + width - 40, rowY, 40, {
      size: 8.5,
      color: COLORS.slate,
      align: 'right',
    });
    rule(doc, rowY + 16, COLORS.ruleSoft, 0.5, MARGIN, MARGIN + width);
  });

  /* --- Right: backlinks added per day -------------------------------- */
  const rightX = MARGIN + width + gap;
  const latest = latestOf(backlinks.map((item) => item.createdAt)) ?? new Date();
  panelTitle(
    doc,
    'Backlinks added',
    `Per day, five days ending ${shortDate(latest)}`,
    rightX,
    y,
    width,
  );
  const days = Array.from({ length: 5 }, (_, index) => {
    const day = new Date(latest);
    day.setDate(day.getDate() - (4 - index));
    return {
      label: shortDate(day),
      count: backlinks.filter(
        (item) => new Date(item.createdAt).toDateString() === day.toDateString(),
      ).length,
    };
  });
  const maxCount = Math.max(1, ...days.map((day) => day.count));
  const baseY = y + 122;
  const areaHeight = 62;
  const slot = width / days.length;
  rule(doc, baseY, COLORS.rule, 0.8, rightX, rightX + width);
  days.forEach((day, index) => {
    const barWidth = 24;
    const barX = rightX + index * slot + (slot - barWidth) / 2;
    const barHeight = (day.count / maxCount) * areaHeight;
    if (barHeight > 0)
      doc
        .rect(barX, baseY - barHeight, barWidth, barHeight)
        .fillColor(SERIES[0])
        .fill();
    line(doc, String(day.count), barX - 8, baseY - barHeight - 11, barWidth + 16, {
      font: FONT.bold,
      size: 7.5,
      color: day.count ? COLORS.navy : COLORS.grey,
      align: 'center',
    });
    line(doc, day.label, barX - 12, baseY + 6, barWidth + 24, {
      size: 7,
      color: COLORS.slate,
      align: 'center',
    });
  });

  doc.y = y + height + 18;
}

/* ========================================================================== */
/* 6. PAGE BUILDERS                                                           */
/* ========================================================================== */

/* ----- 6.1 Cover ---------------------------------------------------------- */

/**
 * Draws the cover and returns the Y where the contents list should start
 * (it is filled in at the end, once page numbers are known).
 */
function cover(doc: Doc, data: ReportData): number {
  const bandHeight = 92;

  // Solid identity band (no gradients or shapes) with an accent edge.
  doc.rect(0, 0, PAGE_WIDTH, bandHeight).fillColor(COLORS.navy).fill();
  doc.rect(0, bandHeight, PAGE_WIDTH, 3).fillColor(COLORS.accent).fill();

  const logoDrawn = drawBrandLogo(doc, data.logo, MARGIN, 30, [136, 32]);
  if (!logoDrawn)
    line(doc, 'TAPVERA', MARGIN, 38, 200, {
      font: FONT.bold,
      size: 18,
      color: COLORS.white,
      spacing: 2,
    });
  line(doc, 'CONFIDENTIAL', PAGE_WIDTH - MARGIN - 160, 42, 160, {
    font: FONT.bold,
    size: 7.5,
    color: COLORS.onNavy,
    align: 'right',
    spacing: 1.6,
  });

  /* --- Title block ---------------------------------------------------- */
  let y = 150;
  line(doc, 'PROJECT PERFORMANCE REPORT', MARGIN, y, CONTENT_WIDTH, {
    font: FONT.bold,
    size: 9,
    color: COLORS.accent,
    spacing: 2.2,
  });
  y += 20;

  const projectName = safeText(data.project.name);
  doc.font(FONT.serifBold).fontSize(32);
  const nameHeight = Math.min(
    76,
    doc.heightOfString(projectName, { width: CONTENT_WIDTH }),
  );
  doc
    .fillColor(COLORS.navy)
    .text(projectName, MARGIN, y, { width: CONTENT_WIDTH, height: 76, ellipsis: true });
  y += nameHeight + 8;

  line(doc, safeText(data.project.businessName), MARGIN, y, CONTENT_WIDTH, {
    size: 13,
    color: COLORS.slate,
  });
  y += 24;
  line(
    doc,
    `Reporting period: last 90 days   ·   Generated ${date(new Date())}`,
    MARGIN,
    y,
    CONTENT_WIDTH,
    { size: 8.5, color: COLORS.grey },
  );
  y += 22;
  rule(doc, y, COLORS.navy, 1.2);
  y += 18;

  /* --- Project facts -------------------------------------------------- */
  const colGap = 28;
  const colWidth = (CONTENT_WIDTH - colGap) / 2;
  const rightX = MARGIN + colWidth + colGap;
  field(doc, 'Client', safeText(data.project.clientName), MARGIN, y, colWidth);
  field(
    doc,
    'Project status',
    humanize(safeText(data.project.workStatus)),
    rightX,
    y,
    colWidth,
  );
  y += 42;
  field(doc, 'Start date', date(data.project.startDate), MARGIN, y, colWidth);
  field(doc, 'Expected end', date(data.project.expectedEndDate), rightX, y, colWidth);
  y += 42;

  const services = data.project.services
    .map((service) =>
      service.service === 'other'
        ? (service.otherLabel ?? 'Other')
        : humanize(service.service),
    )
    .join('  ·  ');
  const team = data.project.assignees.map((assignee) => assignee.fullName).join('  ·  ');
  field(doc, 'Services', services || 'No services selected', MARGIN, y, CONTENT_WIDTH);
  y += 42;
  field(
    doc,
    'Project team',
    team || 'No team members assigned',
    MARGIN,
    y,
    CONTENT_WIDTH,
  );
  y += 52;

  /* --- Key figures ---------------------------------------------------- */
  doc.y = y;
  kpiRow(doc, [
    { label: 'Tracked keywords', value: data.summary.totalKeywords },
    { label: 'Blog posts', value: data.summary.totalBlogs },
    { label: 'Backlinks', value: data.backlinks.length },
    { label: 'Screenshots', value: data.screenshots.length },
  ]);

  return doc.y + 8;
}

/* ----- 6.2 Contents (filled in after the page count is known) ------------- */

/** Draws the contents list on the cover with dotted leaders and page numbers. */
function drawContents(doc: Doc, toc: TocEntry[], startY: number): void {
  doc.switchToPage(0);
  caption(doc, 'Contents', MARGIN, startY, 200);
  rule(doc, startY + 14, COLORS.rule, 0.6);

  toc.forEach((entry, index) => {
    const rowY = startY + 26 + index * 32;
    line(doc, String(index + 1).padStart(2, '0'), MARGIN, rowY, 24, {
      font: FONT.bold,
      size: 8.5,
      color: COLORS.accent,
    });

    doc.font(FONT.bold).fontSize(10.5);
    const titleWidth = doc.widthOfString(entry.title);
    line(doc, entry.title, MARGIN + 28, rowY - 1, CONTENT_WIDTH - 80, {
      font: FONT.bold,
      size: 10.5,
      color: COLORS.navy,
    });
    line(doc, entry.description, MARGIN + 28, rowY + 12, CONTENT_WIDTH - 80, {
      size: 7.5,
      color: COLORS.grey,
    });

    // Dotted leader from the title to the page number.
    doc.save();
    doc
      .moveTo(MARGIN + 28 + titleWidth + 8, rowY + 8)
      .lineTo(PAGE_WIDTH - MARGIN - 28, rowY + 8)
      .lineWidth(0.6)
      .dash(0.6, { space: 2.6 })
      .strokeColor(COLORS.rule)
      .stroke();
    doc.undash().restore();

    line(doc, String(entry.page), PAGE_WIDTH - MARGIN - 24, rowY - 1, 24, {
      font: FONT.bold,
      size: 10.5,
      color: COLORS.navy,
      align: 'right',
    });
  });
}

/* ----- 6.3 Keyword analysis ---------------------------------------------- */

/** Colour, label and mark kind for a keyword trend value. */
function trendStyle(trend: Keyword['trend']): {
  color: string;
  label: string;
  mark: 'up' | 'down' | 'flat';
} {
  if (trend === 'improving')
    return { color: COLORS.green, label: 'Improved', mark: 'up' };
  if (trend === 'declining')
    return { color: COLORS.red, label: 'Declined', mark: 'down' };
  if (trend === 'stagnant')
    return { color: COLORS.slate, label: 'No change', mark: 'flat' };
  return { color: COLORS.grey, label: 'Unclassified', mark: 'flat' };
}

function keywordSection(doc: Doc, data: ReportData, toc: TocEntry[]): void {
  const total = data.summary.totalKeywords;
  const improved = data.summary.improving;
  const declined = data.summary.declining;
  const unchanged = Math.max(0, total - improved - declined);

  sectionPage(doc, toc, {
    number: 1,
    kicker: 'On-page SEO',
    title: 'Keyword Analysis',
    subtitle: 'Search visibility movement across tracked keywords',
    summary: total
      ? `${improved} of ${plural(total, 'tracked keyword')} improved ${improved === 1 ? 'its' : 'their'} ranking over the period, ${declined} declined and ${unchanged} showed no change.`
      : 'No keywords are being tracked for this project yet.',
  });

  kpiRow(doc, [
    { label: 'Total keywords', value: total },
    {
      label: 'Improved',
      value: improved,
      color: COLORS.green,
      note: `${percent(improved, total)}% of tracked`,
    },
    {
      label: 'Declined',
      value: declined,
      color: declined ? COLORS.red : COLORS.navy,
      note: `${percent(declined, total)}% of tracked`,
    },
  ]);

  keywordTrendChart(doc, data.keywords);
  blockHeading(doc, 'Tracked keywords', `${plural(data.keywords.length, 'keyword')}`);

  const columns: Column[] = [
    { label: '#', width: 28 },
    { label: 'Keyword', width: 186 },
    { label: 'Past rank', width: 72, align: 'right' },
    { label: 'Previous', width: 72, align: 'right' },
    { label: 'Current', width: 72, align: 'right' },
    { label: 'Trend', width: CONTENT_WIDTH - 430 },
  ];
  drawTable(doc, {
    title: 'Keyword Analysis',
    columns,
    rows: data.keywords,
    rowHeight: 26,
    empty: 'No active keyword tracking records.',
    renderRow: (item, index, y, xs) => {
      const textY = y + 9;
      cell(doc, columns, xs, 0, String(index + 1), textY, {
        size: 8,
        color: COLORS.grey,
      });
      cell(doc, columns, xs, 1, item.keyword, textY, { font: FONT.bold, size: 9 });
      cell(doc, columns, xs, 2, item.pastRank?.toString() ?? 'N/A', textY, { size: 9 });
      cell(doc, columns, xs, 3, item.previousRank?.toString() ?? 'N/A', textY, { size: 9 });
      cell(doc, columns, xs, 4, item.currentRank?.toString() ?? 'N/A', textY, {
        font: FONT.bold,
        size: 9,
        color: COLORS.navy,
      });
      const style = trendStyle(item.trend);
      const trendX = (xs[5] ?? MARGIN) + 20;
      trendMark(doc, style.mark, trendX, y + 13, style.color);
      line(doc, style.label, trendX + 10, textY, 70, {
        font: FONT.bold,
        size: 8,
        color: style.color,
      });
    },
  });
}

/* ----- 6.4 Blog updates --------------------------------------------------- */

function blogSection(doc: Doc, data: ReportData, toc: TocEntry[]): void {
  const total = data.summary.totalBlogs;
  const latest = latestOf(data.blogs.map((item) => item.publishDate));

  sectionPage(doc, toc, {
    number: 2,
    kicker: 'On-page SEO',
    title: 'Blog Updates',
    subtitle: 'Published content and the latest publishing activity',
    summary: total
      ? `${plural(total, 'blog post')} ${total === 1 ? 'is' : 'are'} on record for this project${latest ? `; the most recent was published on ${date(latest)}` : ''}.`
      : 'No blog posts have been recorded for this project yet.',
  });

  kpiRow(doc, [
    { label: 'Total blog posts', value: total },
    { label: 'Latest publication', value: latest ? date(latest) : '—' },
  ]);

  blockHeading(
    doc,
    'Blog register',
    plural(data.blogs.length, 'entry').replace('entrys', 'entries'),
  );

  const columns: Column[] = [
    { label: '#', width: 28 },
    { label: 'Title / URL', width: 225 },
    { label: 'Published', width: 75 },
    { label: 'Added by', width: 95 },
    // Keep enough room for the complete "Archived" / "Published" label.
    { label: 'Status', width: CONTENT_WIDTH - 423 },
  ];
  drawTable(doc, {
    title: 'Blog Updates',
    columns,
    rows: data.blogs,
    rowHeight: 40,
    empty: 'No blog updates found.',
    renderRow: (item, index, y, xs) => {
      cell(doc, columns, xs, 0, String(index + 1), y + 9, {
        size: 8,
        color: COLORS.grey,
      });
      cell(doc, columns, xs, 1, item.title, y + 8, { font: FONT.bold, size: 9.5 });
      // PDF URI annotations open the external URL in the reader/browser's
      // external-link context; PDFKit does not support HTML target=_blank.
      if (item.url)
        cell(doc, columns, xs, 1, item.url, y + 22, {
          size: 7.5,
          color: COLORS.link,
          link: item.url,
          underline: true,
        });
      else
        cell(doc, columns, xs, 1, 'No URL provided', y + 22, {
          font: FONT.italic,
          size: 7.5,
          color: COLORS.grey,
        });
      cell(doc, columns, xs, 2, date(item.publishDate), y + 9, { size: 8.5 });
      cell(doc, columns, xs, 3, safeText(item.createdByName), y + 9, {
        size: 8.5,
        color: COLORS.slate,
      });
      const status = blogStatusLabel(item.status);
      const statusColor =
        item.status === 'published'
          ? COLORS.green
          : item.status === 'archived'
            ? COLORS.red
            : COLORS.slate;
      cell(doc, columns, xs, 4, status, y + 9, {
        font: FONT.bold,
        size: 8,
        color: statusColor,
      });
    },
  });
}

/* ----- 6.5 Off-page SEO --------------------------------------------------- */

function backlinkSection(doc: Doc, data: ReportData, toc: TocEntry[]): void {
  const total = data.backlinks.length;
  const social = data.backlinks.filter((item) => item.category === 'social_media').length;
  const others = total - social;

  sectionPage(doc, toc, {
    number: 3,
    kicker: 'Off-page SEO',
    title: 'Off-page SEO',
    subtitle: 'Backlink coverage and acquisition records',
    summary: total
      ? `${plural(total, 'backlink')} ${total === 1 ? 'has' : 'have'} been recorded: ${social} (${percent(social, total)}%) from social media and ${others} (${percent(others, total)}%) from other sources.`
      : 'No backlinks have been recorded for this project yet.',
  });

  kpiRow(doc, [
    { label: 'Total backlinks', value: total },
    { label: 'Social media', value: social, note: `${percent(social, total)}% of total` },
    {
      label: 'Other sources',
      value: others,
      note: `${percent(others, total)}% of total`,
    },
  ]);

  backlinkCharts(doc, data.backlinks);
  blockHeading(doc, 'Backlink register', plural(total, 'backlink'));

  const columns: Column[] = [
    { label: '#', width: 24 },
    { label: 'Domain', width: 150 },
    { label: 'Category', width: 85 },
    { label: 'Added', width: 70 },
    { label: 'Added by', width: 100 },
    { label: 'Status', width: CONTENT_WIDTH - 429 },
  ];
  drawTable(doc, {
    title: 'Off-page SEO',
    columns,
    rows: data.backlinks,
    rowHeight: 24,
    empty: 'No active backlinks found.',
    renderRow: (item, index, y, xs) => {
      const textY = y + 8;
      let label = item.url;
      try {
        label = new URL(item.url).hostname.replace(/^www\./, '');
      } catch {
        /* keep the raw URL when it cannot be parsed */
      }
      cell(doc, columns, xs, 0, String(index + 1), textY, {
        size: 8,
        color: COLORS.grey,
      });
      cell(doc, columns, xs, 1, label, textY, {
        font: FONT.bold,
        size: 8.5,
        color: COLORS.link,
        link: item.url,
      });
      cell(
        doc,
        columns,
        xs,
        2,
        item.category === 'social_media' ? 'Social media' : 'Other',
        textY,
        { size: 8.5 },
      );
      cell(doc, columns, xs, 3, date(item.createdAt), textY, { size: 8 });
      cell(doc, columns, xs, 4, safeText(item.createdByName), textY, {
        size: 8,
        color: COLORS.slate,
      });
      doc
        .rect((xs[5] ?? MARGIN) + 6, y + 10, 4.5, 4.5)
        .fillColor(COLORS.green)
        .fill();
      line(doc, 'Active', (xs[5] ?? MARGIN) + 15, textY, 50, {
        font: FONT.bold,
        size: 8,
        color: COLORS.green,
      });
    },
  });
}

/* ----- 6.6 Screenshots ---------------------------------------------------- */

/** One screenshot: framed image with a two-line caption beneath. */
function screenshotTile(
  doc: Doc,
  entry: { item: Screenshot; body: Buffer },
  x: number,
  y: number,
  width: number,
): void {
  const imageHeight = 124;
  doc.rect(x, y, width, imageHeight).fillColor(COLORS.wash).fill();
  doc.save();
  doc.rect(x, y, width, imageHeight).clip();
  try {
    doc.image(entry.body, x + 3, y + 3, {
      fit: [width - 6, imageHeight - 6],
      align: 'center',
      valign: 'center',
    });
  } catch {
    line(doc, 'Image unavailable', x, y + imageHeight / 2 - 5, width, {
      font: FONT.italic,
      size: 8,
      color: COLORS.grey,
      align: 'center',
    });
  }
  doc.restore();
  doc.rect(x, y, width, imageHeight).lineWidth(0.6).strokeColor(COLORS.rule).stroke();

  line(doc, entry.item.title, x, y + imageHeight + 8, width, {
    font: FONT.bold,
    size: 9,
    color: COLORS.navy,
  });
  line(
    doc,
    `${date(entry.item.createdAt)}  ·  ${safeText(entry.item.originalFilename)}  ·  ${Math.ceil(entry.item.sizeBytes / 1024)} KB`,
    x,
    y + imageHeight + 21,
    width,
    { size: 7.5, color: COLORS.slate },
  );
}

function screenshotSection(doc: Doc, data: ReportData, toc: TocEntry[]): void {
  const total = data.screenshots.length;
  const latest = latestOf(data.screenshots.map((entry) => entry.item.createdAt));

  sectionPage(doc, toc, {
    number: 4,
    kicker: 'Project archive',
    title: 'Project Screenshots',
    subtitle: 'Visual progress archive',
    summary: total
      ? `${plural(total, 'screenshot')} ${total === 1 ? 'is' : 'are'} on file${latest ? `; the latest was uploaded on ${date(latest)}` : ''}.`
      : 'No screenshots have been uploaded for this project yet.',
  });

  kpiRow(doc, [
    { label: 'Total screenshots', value: total },
    { label: 'Latest upload', value: latest ? date(latest) : '—' },
  ]);

  if (!total) return;

  const gap = 24;
  const tileWidth = (CONTENT_WIDTH - gap) / 2;
  const rowHeight = 124 + 46;
  for (let start = 0; start < total; start += 2) {
    ensureSpace(doc, rowHeight, 'Project Screenshots');
    const y = doc.y;
    const left = data.screenshots[start];
    const right = data.screenshots[start + 1];
    if (left) screenshotTile(doc, left, MARGIN, y, tileWidth);
    if (right) screenshotTile(doc, right, MARGIN + tileWidth + gap, y, tileWidth);
    doc.y = y + rowHeight;
  }
}

/* ========================================================================== */
/* 7. DOCUMENT ASSEMBLY & PUBLIC EXPORT                                       */
/* ========================================================================== */

/** Streams the PDF into memory and resolves with the finished buffer. */
function buildDocument(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: `Project Performance Report — ${safeText(data.project.name)}`,
        Author: 'Tapvera CRM',
        Subject: 'Project performance report',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      const toc: TocEntry[] = [];

      doc.addPage({ size: 'A4', margin: MARGIN });
      const contentsY = cover(doc, data);

      keywordSection(doc, data, toc);
      blogSection(doc, data, toc);
      backlinkSection(doc, data, toc);
      screenshotSection(doc, data, toc);

      drawContents(doc, toc, contentsY); // page numbers are known now
      pageChrome(doc, safeText(data.project.name), data.logo); // headers + "Page X of Y"
      doc.end();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error('Failed to build project report PDF'),
      );
    }
  });
}

/** Generates the project performance report PDF for the given project. */
export async function createProjectReportPdf(
  ctx: RequestContext,
  projectId: string,
): Promise<Buffer> {
  return buildDocument(await loadData(ctx, projectId));
}
