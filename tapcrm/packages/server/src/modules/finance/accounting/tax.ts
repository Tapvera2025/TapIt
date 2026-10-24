import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { gstr2bImportSchema } from './validators.js';
import { removeTaxFile, readTaxFile, storeTaxFile } from './tax-file-store.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const COMPONENTS = ['igst', 'cgst', 'sgst', 'cess'] as const;
type Component = typeof COMPONENTS[number];
type TaxKind = 'gstr1' | 'gstr3b' | 'gstr2b-import' | 'tds-26q' | 'tds-receivable-reconciliation';

interface TaxQuery { readonly periodId?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined; }
interface TaxWindow { readonly from: string; readonly to: string; }
interface JournalTaxRow {
  readonly journalId: string;
  readonly entryDate: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly systemKey: string | null;
  readonly accountType: string;
  readonly debit: string;
  readonly credit: string;
}
interface TaxTotals { taxable: bigint; output: Record<Component, bigint>; input: Record<Component, bigint>; genericOutput: bigint; genericInput: bigint; }

const zeroComponents = (): Record<Component, bigint> => ({ igst: 0n, cgst: 0n, sgst: 0n, cess: 0n });
const cents = (value: string | number | bigint): bigint => {
  const text = String(value);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
};
const money = (value: bigint): string => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;
const componentFor = (key: string | null): Component | null => {
  if (!key) return null;
  for (const component of COMPONENTS) if (key.endsWith(`-${component}`)) return component;
  return null;
};

async function resolveWindow(ctx: RequestContext, query: TaxQuery): Promise<TaxWindow> {
  if (query.periodId) {
    const period = await db.one<{ from: string; to: string }>(ctx, sql`
      SELECT period_start::text AS "from", period_end::text AS "to"
      FROM accounting_period WHERE organization_id = ${ctx.organizationId} AND id = ${query.periodId}::uuid
    `);
    return period;
  }
  if (!query.from || !query.to) throw new Error('A period or complete date range is required.');
  return { from: query.from, to: query.to };
}

async function taxRows(ctx: RequestContext, window: TaxWindow): Promise<JournalTaxRow[]> {
  return db.query<JournalTaxRow>(ctx, sql`
    SELECT je.id AS "journalId", je.entry_date::text AS "entryDate", je.source_type AS "sourceType",
           je.source_id AS "sourceId", la.system_key AS "systemKey", la.account_type AS "accountType",
           jl.debit::text AS debit, jl.credit::text AS credit
    FROM journal_entry je
    JOIN journal_line jl ON jl.organization_id = je.organization_id AND jl.journal_entry_id = je.id
    JOIN ledger_account la ON la.organization_id = jl.organization_id AND la.id = jl.ledger_account_id
    WHERE je.organization_id = ${ctx.organizationId}
      AND je.entry_date BETWEEN ${window.from}::date AND ${window.to}::date
    ORDER BY je.entry_date, je.id, jl.line_number
  `);
}

function totals(rows: readonly JournalTaxRow[]): TaxTotals {
  const output = zeroComponents(); const input = zeroComponents();
  let taxable = 0n; let genericOutput = 0n; let genericInput = 0n;
  for (const row of rows) {
    const netCredit = cents(row.credit) - cents(row.debit);
    if (row.accountType === 'income') taxable += netCredit;
    if (row.systemKey === 'gst-payable') genericOutput += netCredit;
    if (row.systemKey === 'input-gst') genericInput += cents(row.debit) - cents(row.credit);
    const component = componentFor(row.systemKey);
    if (component && row.systemKey?.startsWith('output-')) output[component] += netCredit;
    if (component && row.systemKey?.startsWith('input-')) input[component] += cents(row.debit) - cents(row.credit);
  }
  return { taxable, output, input, genericOutput, genericInput };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csv(headers: readonly string[], rows: readonly (readonly unknown[])[]): Buffer {
  return Buffer.from([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n', 'utf8');
}

interface ArtifactRow { id: string; kind: TaxKind; filename: string; relativePath: string; mimeType: string; sizeBytes: number; sha256: string; rowCount: number; periodStart: string; periodEnd: string; metadata: Record<string, unknown>; createdAt: Date; importId?: string | undefined; }
async function persistArtifact(ctx: RequestContext, input: { kind: TaxKind; window: TaxWindow; filename: string; body: Buffer; rowCount: number; metadata?: Record<string, unknown> }): Promise<ArtifactRow> {
  const id = randomUUID();
  const stored = await storeTaxFile(ctx.organizationId, id, 'csv', input.body);
  try {
    return await db.transaction(ctx, (tx) => tx.one<ArtifactRow>(sql`
      INSERT INTO accounting_tax_artifact
        (id, organization_id, kind, period_start, period_end, filename, relative_path, mime_type, size_bytes, sha256, row_count, metadata, created_by)
      VALUES (${id}::uuid, ${ctx.organizationId}, ${input.kind}, ${input.window.from}::date, ${input.window.to}::date,
              ${input.filename}, ${stored.relativePath}, 'text/csv', ${stored.sizeBytes}, ${stored.sha256}, ${input.rowCount},
              ${JSON.stringify(input.metadata ?? {})}::jsonb, ${ctx.principal.id}::uuid)
      RETURNING id, kind, filename, relative_path AS "relativePath", mime_type AS "mimeType", size_bytes AS "sizeBytes",
                sha256, row_count AS "rowCount", period_start::text AS "periodStart", period_end::text AS "periodEnd", metadata, created_at AS "createdAt"
    `));
  } catch (error) {
    await removeTaxFile(stored.relativePath);
    throw error;
  }
}

function groupedGstr1(rows: readonly JournalTaxRow[], orgGstin: string): (readonly unknown[])[] {
  const grouped = new Map<string, { date: string; sourceType: string; sourceId: string; taxable: bigint; tax: bigint }>();
  for (const row of rows) {
    const component = row.systemKey?.startsWith('output-') || row.systemKey === 'gst-payable';
    if (!component && row.accountType !== 'income') continue;
    const key = row.journalId;
    const item = grouped.get(key) ?? { date: row.entryDate, sourceType: row.sourceType, sourceId: row.sourceId ?? '', taxable: 0n, tax: 0n };
    if (row.accountType === 'income') item.taxable += cents(row.credit) - cents(row.debit);
    if (component) item.tax += cents(row.credit) - cents(row.debit);
    grouped.set(key, item);
  }
  return [...grouped.values()]
    .filter((item) => item.taxable !== 0n || item.tax !== 0n)
    .map((item) => [orgGstin, item.sourceType, item.sourceId, item.date, money(item.taxable), money(item.tax)]);
}

async function organizationTaxIdentity(ctx: RequestContext): Promise<{ gstin: string; pan: string }> {
  return db.one<{ gstin: string; pan: string }>(ctx, sql`SELECT gstin, pan FROM organization WHERE id = ${ctx.organizationId}`);
}

export async function exportGstr1(ctx: RequestContext, query: TaxQuery): Promise<ArtifactRow> {
  const window = await resolveWindow(ctx, query); const identity = await organizationTaxIdentity(ctx);
  const rows = groupedGstr1(await taxRows(ctx, window), identity.gstin);
  return persistArtifact(ctx, { kind: 'gstr1', window, filename: `gstr-1-${window.from}-${window.to}.csv`, body: csv(['gstin', 'sourceType', 'sourceId', 'invoiceDate', 'taxableValue', 'totalTax'], rows), rowCount: rows.length, metadata: { ledgerDriven: true } });
}

export async function exportGstr3b(ctx: RequestContext, query: TaxQuery): Promise<ArtifactRow> {
  const window = await resolveWindow(ctx, query); const summary = totals(await taxRows(ctx, window));
  const row = [money(summary.taxable), ...COMPONENTS.map((component) => money(summary.output[component])), money(summary.genericOutput), ...COMPONENTS.map((component) => money(summary.input[component])), money(summary.genericInput), money(summary.output.igst + summary.output.cgst + summary.output.sgst + summary.output.cess + summary.genericOutput - summary.input.igst - summary.input.cgst - summary.input.sgst - summary.input.cess - summary.genericInput)];
  return persistArtifact(ctx, { kind: 'gstr3b', window, filename: `gstr-3b-${window.from}-${window.to}.csv`, body: csv(['outwardTaxableValue', 'outputIgst', 'outputCgst', 'outputSgst', 'outputCess', 'outputGenericGst', 'inputIgst', 'inputCgst', 'inputSgst', 'inputCess', 'inputGenericGst', 'netTaxPayable'], [row]), rowCount: 1, metadata: { ledgerDriven: true } });
}

export async function exportTds(ctx: RequestContext, query: TaxQuery): Promise<ArtifactRow> {
  const window = await resolveWindow(ctx, query); const identity = await organizationTaxIdentity(ctx);
  const rows = (await taxRows(ctx, window)).filter((row) => row.systemKey === 'tds-payable' || row.systemKey === 'tds-receivable').map((row) => [identity.pan, row.entryDate, row.sourceType, row.sourceId ?? '', row.systemKey === 'tds-payable' ? 'deducted' : 'receivable', money(row.systemKey === 'tds-payable' ? cents(row.credit) - cents(row.debit) : cents(row.debit) - cents(row.credit))]);
  return persistArtifact(ctx, { kind: 'tds-26q', window, filename: `tds-${window.from}-${window.to}.csv`, body: csv(['pan', 'entryDate', 'sourceType', 'sourceId', 'role', 'amount'], rows), rowCount: rows.length, metadata: { ledgerDriven: true, sourceDetailRequired: true } });
}

export async function exportTdsReceivableReconciliation(ctx: RequestContext, query: TaxQuery): Promise<ArtifactRow> {
  const window = await resolveWindow(ctx, query); const rows = (await taxRows(ctx, window)).filter((row) => row.systemKey === 'tds-receivable');
  const balance = rows.reduce((total, row) => total + cents(row.debit) - cents(row.credit), 0n);
  return persistArtifact(ctx, { kind: 'tds-receivable-reconciliation', window, filename: `tds-receivable-reconciliation-${window.from}-${window.to}.csv`, body: csv(['periodStart', 'periodEnd', 'ledgerReceivable', 'sourceRows', 'status'], [[window.from, window.to, money(balance), rows.length, 'ledger-only-source-detail-required']]), rowCount: 1, metadata: { ledgerDriven: true, sourceDetailRequired: true } });
}

function canonicalHeader(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i += 1; row.push(cell.trim()); if (row.some((value) => value !== '')) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some((value) => value !== '')) rows.push(row); }
  return rows;
}
function requiredColumn(headers: string[], aliases: string[]): number { const index = headers.findIndex((header) => aliases.includes(canonicalHeader(header))); if (index < 0) throw new Error(`GSTR-2B is missing required column: ${aliases[0]}.`); return index; }
function decimalInput(value: string, label: string): string { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Invalid ${label} in GSTR-2B import.`); return value; }

export async function importGstr2b(ctx: RequestContext, input: unknown) {
  const parsed = gstr2bImportSchema.parse(input); const comma = parsed.contentBase64.indexOf(','); const encoded = (comma >= 0 ? parsed.contentBase64.slice(comma + 1) : parsed.contentBase64).replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('Invalid GSTR-2B file content.');
  const body = Buffer.from(encoded, 'base64'); if (body.length === 0 || body.length > MAX_IMPORT_BYTES) throw new Error('GSTR-2B file must be between 1 byte and 10 MB.');
  const rows = parseCsv(body.toString('utf8')); if (rows.length < 1) throw new Error('GSTR-2B file has no header.');
  const headers = rows[0]!; const columns = {
    supplier: requiredColumn(headers, ['suppliergstin', 'gstin']), invoice: requiredColumn(headers, ['invoicenumber', 'invoiceno']), date: requiredColumn(headers, ['invoicedate', 'date']), taxable: requiredColumn(headers, ['taxablevalue', 'taxableamount']), igst: requiredColumn(headers, ['igst']), cgst: requiredColumn(headers, ['cgst']), sgst: requiredColumn(headers, ['sgst']), cess: requiredColumn(headers, ['cess']),
  };
  const lines = rows.slice(1).map((row) => ({ supplierGstin: row[columns.supplier] ?? '', invoiceNumber: row[columns.invoice] ?? '', invoiceDate: row[columns.date] ?? '', taxableValue: decimalInput(row[columns.taxable] ?? '', 'taxable value'), igst: decimalInput(row[columns.igst] ?? '0', 'IGST'), cgst: decimalInput(row[columns.cgst] ?? '0', 'CGST'), sgst: decimalInput(row[columns.sgst] ?? '0', 'SGST'), cess: decimalInput(row[columns.cess] ?? '0', 'cess') }));
  if (lines.some((line) => !line.supplierGstin || !line.invoiceNumber || !/^\d{4}-\d{2}-\d{2}$/.test(line.invoiceDate))) throw new Error('GSTR-2B contains an invalid supplier GSTIN, invoice number, or ISO invoice date.');
  const artifactId = randomUUID(); const stored = await storeTaxFile(ctx.organizationId, artifactId, 'csv', body);
  try {
    return await db.transaction(ctx, async (tx) => {
      const artifact = await tx.one<ArtifactRow>(sql`INSERT INTO accounting_tax_artifact (id, organization_id, kind, period_start, period_end, filename, relative_path, mime_type, size_bytes, sha256, row_count, metadata, created_by) VALUES (${artifactId}::uuid, ${ctx.organizationId}, 'gstr2b-import', ${parsed.periodStart}::date, ${parsed.periodEnd}::date, ${parsed.filename}, ${stored.relativePath}, 'text/csv', ${stored.sizeBytes}, ${stored.sha256}, ${lines.length}, '{"imported":true}'::jsonb, ${ctx.principal.id}::uuid) RETURNING id, kind, filename, relative_path AS "relativePath", mime_type AS "mimeType", size_bytes AS "sizeBytes", sha256, row_count AS "rowCount", period_start::text AS "periodStart", period_end::text AS "periodEnd", metadata, created_at AS "createdAt"`);
      const imported = await tx.one<{ id: string }>(sql`INSERT INTO accounting_gstr2b_import (organization_id, artifact_id, period_start, period_end, original_filename, row_count, imported_by) VALUES (${ctx.organizationId}, ${artifactId}::uuid, ${parsed.periodStart}::date, ${parsed.periodEnd}::date, ${parsed.filename}, ${lines.length}, ${ctx.principal.id}::uuid) RETURNING id`);
      for (const line of lines) await tx.query(sql`INSERT INTO accounting_gstr2b_line (organization_id, import_id, supplier_gstin, invoice_number, invoice_date, taxable_value, igst, cgst, sgst, cess) VALUES (${ctx.organizationId}, ${imported.id}::uuid, ${line.supplierGstin}, ${line.invoiceNumber}, ${line.invoiceDate}::date, ${line.taxableValue}::numeric, ${line.igst}::numeric, ${line.cgst}::numeric, ${line.sgst}::numeric, ${line.cess}::numeric)`);
      return { artifact, importId: imported.id, rowCount: lines.length };
    });
  } catch (error) { await removeTaxFile(stored.relativePath); throw error; }
}

export async function reconcileGstr2b(ctx: RequestContext, importId: string) {
  const imported = await db.one<{ id: string; periodStart: string; periodEnd: string }>(ctx, sql`SELECT id, period_start::text AS "periodStart", period_end::text AS "periodEnd" FROM accounting_gstr2b_import WHERE organization_id = ${ctx.organizationId} AND id = ${importId}::uuid`);
  const importedTotals = await db.one<{ tax: string; taxable: string }>(ctx, sql`SELECT COALESCE(sum(igst + cgst + sgst + cess), 0)::text AS tax, COALESCE(sum(taxable_value), 0)::text AS taxable FROM accounting_gstr2b_line WHERE organization_id = ${ctx.organizationId} AND import_id = ${imported.id}::uuid`);
  const summary = totals(await taxRows(ctx, { from: imported.periodStart, to: imported.periodEnd }));
  const ledgerTax = summary.input.igst + summary.input.cgst + summary.input.sgst + summary.input.cess + summary.genericInput;
  const importedTax = cents(importedTotals.tax);
  const result = { importId, periodStart: imported.periodStart, periodEnd: imported.periodEnd, importedTax: money(importedTax), ledgerInputTax: money(ledgerTax), variance: money(ledgerTax - importedTax), status: ledgerTax === importedTax ? 'matched' : 'variance' };
  await db.query(ctx, sql`UPDATE accounting_gstr2b_import SET status = ${result.status === 'matched' ? 'reconciled' : 'imported'}, summary = ${JSON.stringify(result)}::jsonb WHERE organization_id = ${ctx.organizationId} AND id = ${importId}::uuid`);
  return result;
}

export async function listTaxArtifacts(ctx: RequestContext) { return { artifacts: await db.query<ArtifactRow>(ctx, sql`SELECT a.id, a.kind, a.filename, a.relative_path AS "relativePath", a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes", a.sha256, a.row_count AS "rowCount", a.period_start::text AS "periodStart", a.period_end::text AS "periodEnd", a.metadata, a.created_at AS "createdAt", i.id AS "importId" FROM accounting_tax_artifact a LEFT JOIN accounting_gstr2b_import i ON i.organization_id = a.organization_id AND i.artifact_id = a.id WHERE a.organization_id = ${ctx.organizationId} ORDER BY a.created_at DESC`) }; }
export async function loadTaxArtifactResource(ctx: RequestContext, id: string) { const row = await db.maybeOne<{ id: string; organizationId: string }>(ctx, sql`SELECT id, organization_id AS "organizationId" FROM accounting_tax_artifact WHERE organization_id = ${ctx.organizationId} AND id = ${id}::uuid`); return row ? { type: 'taxExportArtifact', id: row.id, organizationId: row.organizationId } : null; }
export async function downloadTaxArtifact(ctx: RequestContext, id: string) { const row = await db.one<ArtifactRow>(ctx, sql`SELECT id, kind, filename, relative_path AS "relativePath", mime_type AS "mimeType", size_bytes AS "sizeBytes", sha256, row_count AS "rowCount", period_start::text AS "periodStart", period_end::text AS "periodEnd", metadata, created_at AS "createdAt" FROM accounting_tax_artifact WHERE organization_id = ${ctx.organizationId} AND id = ${id}::uuid`); return { row, body: await readTaxFile(row.relativePath) }; }
