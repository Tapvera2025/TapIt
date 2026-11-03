/**
 * SEO site PDF report generator.
 *
 * One API call: `generateSeoReport(ctx, siteId): Promise<Buffer>`.
 *
 * Layout (letter size, portrait, 50pt margins):
 *   Page 1 — Cover
 *     site display URL, generated date, period covered, scan count, open-findings total
 *   Page 2 — Findings
 *     severity breakdown, then top-15 open issues ordered by priority_score
 *   Page 3 — Core Web Vitals + Search Performance
 *     latest origin-level CrUX ratings, 28-day GSC totals + top 10 queries
 *
 * Deliberately zero charts — the project-report PDF already shows those cost a
 * lot of code. For a weekly SEO summary a clean typographic table beats a chart
 * nobody prints at readable size.
 */
import PDFDocument from 'pdfkit';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { SeoSiteNotFoundError } from './errors.js';

// ─── Design tokens ───────────────────────────────────────────────────────────

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  rule: '#d1d5db',
  critical: '#b91c1c',
  high: '#c2410c',
  moderate: '#a16207',
  low: '#1d4ed8',
  informational: '#4b5563',
} as const;

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4, high: 3, moderate: 2, low: 1, informational: 0,
};

// ─── Public entry ────────────────────────────────────────────────────────────

export async function generateSeoReport(ctx: RequestContext, siteId: string): Promise<Buffer> {
  const site = await db.maybeOne<{ id: string; displayUrl: string; normalizedHost: string; locale: string; timezone: string }>(ctx, sql`
    SELECT id, display_url, normalized_host, locale, timezone
    FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
  `);
  if (!site) throw new SeoSiteNotFoundError();

  const data = await loadReportData(ctx, site.id);
  return renderPdf(site, data);
}

// ─── Data loading ────────────────────────────────────────────────────────────

interface ReportData {
  generatedAt: Date;
  scanCount: number;
  latestScanAt: Date | null;
  openFindings: number;
  findingsBySeverity: Record<string, number>;
  topFindings: Array<{ ruleId: string; severity: string; affectedTarget: string; priorityScore: number | null; firstSeenAt: Date }>;
  crux: { lcpP75: number | null; lcpRating: string | null; inpP75: number | null; inpRating: string | null; clsP75: number | null; clsRating: string | null } | null;
  gsc: { clicks: number; impressions: number; avgPosition: number | null; topQueries: Array<{ query: string; clicks: number; impressions: number; position: number | null }> };
}

async function loadReportData(ctx: RequestContext, siteId: string): Promise<ReportData> {
  const scanAgg = await db.one<{ count: string; latest: Date | null }>(ctx, sql`
    SELECT COUNT(*)::text AS count, MAX(ended_at) AS latest
    FROM seo_scan_runs
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
      AND ended_at >= now() - interval '28 days'
  `);

  const severityRows = await db.query<{ severity: string; count: string }>(ctx, sql`
    SELECT severity, COUNT(*)::text AS count
    FROM seo_findings
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND status = 'open'
    GROUP BY severity
  `);
  const findingsBySeverity: Record<string, number> = { critical: 0, high: 0, moderate: 0, low: 0, informational: 0 };
  for (const row of severityRows) findingsBySeverity[row.severity] = parseInt(row.count, 10);
  const openFindings = Object.values(findingsBySeverity).reduce((a, b) => a + b, 0);

  const topFindings = await db.query<{ ruleId: string; severity: string; affectedTarget: string; priorityScore: number | null; firstSeenAt: Date }>(ctx, sql`
    SELECT rule_id, severity, affected_target, priority_score::float AS priority_score, first_seen_at
    FROM seo_findings
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND status = 'open'
    ORDER BY priority_score DESC NULLS LAST, first_seen_at DESC
    LIMIT 15
  `);

  const cruxRow = await db.maybeOne<{ lcpP75: number | null; lcpRating: string | null; inpP75: number | null; inpRating: string | null; clsP75: string | null; clsRating: string | null }>(ctx, sql`
    SELECT lcp_p75, lcp_rating, inp_p75, inp_rating, cls_p75, cls_rating
    FROM seo_cwv_observations
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND url IS NULL
    ORDER BY observed_at DESC LIMIT 1
  `);
  const crux = cruxRow ? {
    lcpP75: cruxRow.lcpP75,
    lcpRating: cruxRow.lcpRating,
    inpP75: cruxRow.inpP75,
    inpRating: cruxRow.inpRating,
    clsP75: cruxRow.clsP75 != null ? parseFloat(cruxRow.clsP75) : null,
    clsRating: cruxRow.clsRating,
  } : null;

  const gscTotals = await db.one<{ clicks: string; impressions: string; avg_position: string | null }>(ctx, sql`
    SELECT COALESCE(SUM(clicks), 0)::text AS clicks,
           COALESCE(SUM(impressions), 0)::text AS impressions,
           AVG(avg_position)::text AS avg_position
    FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
      AND query IS NOT NULL
      AND date >= (current_date - interval '28 days')::date
  `);
  const topQueries = await db.query<{ query: string; clicks: string; impressions: string; position: string | null }>(ctx, sql`
    SELECT query,
           COALESCE(SUM(clicks), 0)::text AS clicks,
           COALESCE(SUM(impressions), 0)::text AS impressions,
           AVG(avg_position)::text AS position
    FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
      AND query IS NOT NULL AND query <> ''
      AND date >= (current_date - interval '28 days')::date
    GROUP BY query
    ORDER BY SUM(clicks) DESC
    LIMIT 10
  `);

  return {
    generatedAt: new Date(),
    scanCount: parseInt(scanAgg.count, 10),
    latestScanAt: scanAgg.latest,
    openFindings,
    findingsBySeverity,
    topFindings,
    crux,
    gsc: {
      clicks: parseInt(gscTotals.clicks, 10),
      impressions: parseInt(gscTotals.impressions, 10),
      avgPosition: gscTotals.avg_position ? parseFloat(gscTotals.avg_position) : null,
      topQueries: topQueries.map((q) => ({
        query: q.query,
        clicks: parseInt(q.clicks, 10),
        impressions: parseInt(q.impressions, 10),
        position: q.position ? parseFloat(q.position) : null,
      })),
    },
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderPdf(
  site: { displayUrl: string; normalizedHost: string; locale: string },
  data: ReportData,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  renderCover(doc, site, data);
  doc.addPage();
  renderFindings(doc, data);
  doc.addPage();
  renderPerformance(doc, data);

  doc.end();
  return done;
}

function renderCover(
  doc: PDFKit.PDFDocument,
  site: { displayUrl: string; normalizedHost: string; locale: string },
  data: ReportData,
): void {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted)
    .text('SEO INTELLIGENCE REPORT', { align: 'left' });
  doc.moveDown(5);

  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.text).text(site.normalizedHost);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(12).fillColor(COLORS.muted).text(site.displayUrl);

  doc.moveDown(3);
  doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(1);

  const kpiRow = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(label, 50, y);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text).text(value, 300, y);
    doc.moveDown(1);
  };

  kpiRow('Generated', data.generatedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }));
  kpiRow('Reporting period', 'Last 28 days');
  kpiRow('Scans in period', String(data.scanCount));
  kpiRow('Latest scan', data.latestScanAt ? data.latestScanAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : 'No completed scans');
  kpiRow('Open findings', String(data.openFindings));

  doc.moveDown(3);
  doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text('This report summarizes crawler findings, Core Web Vitals and search performance for the above site. Figures are based on data collected by the automated SEO Intelligence module.', { align: 'left' });
}

function renderFindings(doc: PDFKit.PDFDocument, data: ReportData): void {
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.text).text('Findings');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text(`${data.openFindings} open findings across all severities.`);
  doc.moveDown(1);

  // Severity breakdown
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text('By severity');
  doc.moveDown(0.3);
  const severities = ['critical', 'high', 'moderate', 'low', 'informational'] as const;
  for (const sev of severities) {
    const count = data.findingsBySeverity[sev] ?? 0;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS[sev]).text(sev.toUpperCase(), 50, y);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(String(count), 200, y);
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text('Top open issues by priority');
  doc.moveDown(0.3);
  doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  if (data.topFindings.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.muted).text('No open findings. The site is healthy.');
    return;
  }

  for (const f of data.topFindings) {
    const y = doc.y;
    const sevColor = COLORS[f.severity as keyof typeof COLORS] ?? COLORS.text;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(sevColor).text(f.severity.toUpperCase(), 50, y, { width: 80 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text).text(f.ruleId, 140, y, { width: 60 });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(f.affectedTarget, 210, y, { width: 320, ellipsis: true });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(f.priorityScore != null ? f.priorityScore.toFixed(1) : '—', 540, y, { width: 30, align: 'right' });
    doc.moveDown(0.6);
    if (doc.y > 720) { doc.addPage(); }
  }
  void SEVERITY_WEIGHT;
}

function renderPerformance(doc: PDFKit.PDFDocument, data: ReportData): void {
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.text).text('Core Web Vitals');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text('Field data from the Chrome UX Report (mobile, origin-level, 75th percentile).');
  doc.moveDown(1);

  if (!data.crux) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.muted)
      .text('No Core Web Vitals data available. CrUX requires enough real-user traffic to produce samples.');
  } else {
    const cwvRow = (label: string, value: string | null, unit: string, rating: string | null) => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(label, 50, y, { width: 100 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(value != null ? `${value}${unit}` : '—', 160, y, { width: 100 });
      if (rating) {
        const color = rating === 'good' ? '#047857' : rating === 'needs_improvement' ? '#b45309' : '#b91c1c';
        doc.font('Helvetica').fontSize(10).fillColor(color).text(rating.replace(/_/g, ' '), 280, y);
      }
      doc.moveDown(0.8);
    };
    cwvRow('LCP (p75)', data.crux.lcpP75 != null ? (data.crux.lcpP75 / 1000).toFixed(2) : null, 's', data.crux.lcpRating);
    cwvRow('INP (p75)', data.crux.inpP75 != null ? String(data.crux.inpP75) : null, 'ms', data.crux.inpRating);
    cwvRow('CLS (p75)', data.crux.clsP75 != null ? data.crux.clsP75.toFixed(3) : null, '', data.crux.clsRating);
  }

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.text).text('Search Performance');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text('Google Search Console totals and top queries for the last 28 days.');
  doc.moveDown(1);

  const sumRow = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(label, 50, y, { width: 150 });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(value, 220, y);
    doc.moveDown(0.6);
  };
  sumRow('Total clicks', data.gsc.clicks.toLocaleString());
  sumRow('Total impressions', data.gsc.impressions.toLocaleString());
  sumRow('Average position', data.gsc.avgPosition != null ? data.gsc.avgPosition.toFixed(1) : '—');

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text('Top queries by clicks');
  doc.moveDown(0.3);
  doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.4);

  // Header row
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Query', 50, headY, { width: 320 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Clicks', 380, headY, { width: 60, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Impr.', 450, headY, { width: 60, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Pos.', 520, headY, { width: 40, align: 'right' });
  doc.moveDown(0.8);

  if (data.gsc.topQueries.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.muted)
      .text('No GSC data yet. Connect Google Search Console or wait for the next sync.');
    return;
  }

  for (const q of data.gsc.topQueries) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(q.query, 50, y, { width: 320, ellipsis: true });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(q.clicks.toLocaleString(), 380, y, { width: 60, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(q.impressions.toLocaleString(), 450, y, { width: 60, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(q.position != null ? q.position.toFixed(1) : '—', 520, y, { width: 40, align: 'right' });
    doc.moveDown(0.6);
  }
}
