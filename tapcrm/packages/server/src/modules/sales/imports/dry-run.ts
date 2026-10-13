/**
 * Sales v1.1 — per-row validation for CSV imports (R1 plan step 1.11).
 *
 * `validateRows` is pure: given parsed records plus the known lead
 * sources and already-seen contact keys, it returns a per-row verdict
 * and a human-readable suggestion. The service runs this before
 * handing valid rows off to `ingest()`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportRowStatus =
  | 'valid'
  | 'invalid_contact'
  | 'duplicate'
  | 'unknown_source'
  | 'owner_out_of_scope'
  | 'missing_routing_attributes';

export interface RowValidationContext {
  /** `lead_source.name` → `lead_source.id`, lowercased name. */
  readonly knownSourceByName: ReadonlyMap<string, string>;
  /** Lowercased phone / email keys already present in `contact`. */
  readonly existingContactKeys: ReadonlySet<string>;
  /** User ids in-scope for the import's target pool, if restricted. */
  readonly inScopeOwnerUserIds: ReadonlySet<string> | null;
}

export interface ImportRowResult {
  readonly rowKey: string;
  readonly status: ImportRowStatus;
  readonly reason: string;
  readonly suggestion: string;
  readonly record: Readonly<Record<string, string>>;
  readonly normalizedPhone: string | null;
  readonly normalizedEmail: string | null;
  readonly sourceId: string | null;
  readonly ownerUserId: string | null;
}

export interface ImportSummary {
  /** Count of rows in the parsed batch, not a monetary total. */
  readonly total: number;
  readonly valid: number;
  readonly invalid: number;
  readonly byStatus: Readonly<Record<ImportRowStatus, number>>;
}

export function validateRows(
  records: ReadonlyArray<Readonly<Record<string, string>>>,
  ctx: RowValidationContext,
): { readonly results: readonly ImportRowResult[]; readonly summary: ImportSummary } {
  const results: ImportRowResult[] = [];
  const seenInBatch = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const rowKey = pickRowKey(record, i);
    const phone = normalizePhone(record['phone']);
    const email = record['email'] ? record['email'].trim().toLowerCase() : '';
    const sourceName = (record['source'] ?? '').trim().toLowerCase();
    const ownerIdCell = (record['ownerUserId'] ?? '').trim();

    if (!phone && (!email || !EMAIL_RE.test(email))) {
      results.push(invalid(rowKey, record, 'invalid_contact', phone, email, null, null,
        'row has no phone and no valid email',
        'Provide either an E.164 phone number or a valid email in the "phone" / "email" column'));
      continue;
    }
    if (!sourceName) {
      results.push(invalid(rowKey, record, 'missing_routing_attributes', phone, email, null, null,
        'source column is required',
        'Set the "source" column to the name of an active lead source'));
      continue;
    }
    const sourceId = ctx.knownSourceByName.get(sourceName) ?? null;
    if (!sourceId) {
      results.push(invalid(rowKey, record, 'unknown_source', phone, email, null, null,
        `source "${sourceName}" is not a known lead source`,
        'Create the lead source in Settings or correct the spelling'));
      continue;
    }

    const contactKey = (phone || email).toLowerCase();
    if (ctx.existingContactKeys.has(contactKey) || seenInBatch.has(contactKey)) {
      results.push(invalid(rowKey, record, 'duplicate', phone, email, sourceId, null,
        'contact already exists for this phone/email',
        'Remove this row or let the intake dedupe engine link it on commit'));
      continue;
    }

    if (ownerIdCell) {
      if (ctx.inScopeOwnerUserIds !== null && !ctx.inScopeOwnerUserIds.has(ownerIdCell)) {
        results.push(invalid(rowKey, record, 'owner_out_of_scope', phone, email, sourceId, ownerIdCell,
          'ownerUserId is outside the import pool',
          'Leave ownerUserId blank to let routing assign, or pick a user in the target pool'));
        continue;
      }
    }

    results.push({
      rowKey,
      status: 'valid',
      reason: '',
      suggestion: '',
      record,
      normalizedPhone: phone,
      normalizedEmail: email || null,
      sourceId,
      ownerUserId: ownerIdCell || null,
    });
    seenInBatch.add(contactKey);
  }

  const summary = summarize(results);
  return { results, summary };
}

function invalid(
  rowKey: string,
  record: Readonly<Record<string, string>>,
  status: Exclude<ImportRowStatus, 'valid'>,
  phone: string | null,
  email: string,
  sourceId: string | null,
  ownerUserId: string | null,
  reason: string,
  suggestion: string,
): ImportRowResult {
  return {
    rowKey,
    status,
    reason,
    suggestion,
    record,
    normalizedPhone: phone,
    normalizedEmail: email || null,
    sourceId,
    ownerUserId,
  };
}

function summarize(results: readonly ImportRowResult[]): ImportSummary {
  const byStatus: Record<ImportRowStatus, number> = {
    valid: 0,
    invalid_contact: 0,
    duplicate: 0,
    unknown_source: 0,
    owner_out_of_scope: 0,
    missing_routing_attributes: 0,
  };
  for (const r of results) byStatus[r.status]++;
  return {
    total: results.length,
    valid: byStatus.valid,
    invalid: results.length - byStatus.valid,
    byStatus,
  };
}

function pickRowKey(record: Readonly<Record<string, string>>, index: number): string {
  const supplied = (record['rowKey'] ?? record['row_key'] ?? '').trim();
  return supplied || `row-${index + 1}`;
}

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('+')) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
