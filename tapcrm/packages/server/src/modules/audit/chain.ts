import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Audit entry normalisation and hash chaining — TECH.md §9.5.
 *
 * Everything here is pure. The drainer feeds it outbox payloads and stores what
 * it returns; the daily verifier recomputes the same hashes from stored rows.
 * Keeping the chain arithmetic free of I/O is what lets a stored entry be
 * re-verified after the drainer implementation changes (AU-3).
 */

/** Bump when `canonicalize` or the hashed field set changes; stored per entry. */
export const HASH_VERSION = 1;

export const ACTOR_TYPES = ['super-admin', 'employee', 'client', 'service', 'system'] as const;
export type AuditActorType = (typeof ACTOR_TYPES)[number];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** An audit entry before it has been given a sequence, timestamp or hash. */
export interface AuditEntryInput {
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly before: Json;
  readonly after: Json;
  readonly reason: string | null;
  readonly sourceIp: string | null;
  readonly requestId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'action',
  'actorId',
  'actorType',
  'targetType',
  'targetId',
  'before',
  'after',
  'reason',
  'sourceIp',
  'requestId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Converts any JSON-parsed value to `Json`, dropping `undefined` members. */
function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    const out: Record<string, Json> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) out[key] = toJson(member);
    }
    return out;
  }
  return typeof value === 'bigint' || typeof value === 'symbol'
    ? value.toString()
    : `[${typeof value}]`;
}

/**
 * Turns an `audit_outbox.payload` into an entry that always satisfies the
 * `audit_entry` constraints.
 *
 * This never throws. A payload that cannot be stored as-is is repaired and the
 * repair is recorded, because a poison message that blocks a stream is worse
 * than an imperfect entry — "losing an audit entry is worse than an unpartitioned
 * row" (migration 0003). Producers do not share one payload shape, so fields the
 * table has no column for (`kind`, `metadata`, `sessionId`, ...) are preserved
 * under `after._context` instead of being dropped.
 */
export function normalizePayload(payload: unknown): AuditEntryInput {
  const raw = isRecord(payload) ? payload : {};
  const context: Record<string, Json> = {};
  const invalid: Record<string, Json> = {};

  if (!isRecord(payload)) invalid['payload'] = toJson(payload);

  const uuidField = (key: string): string | null => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && UUID.test(value)) return value.toLowerCase();
    invalid[key] = toJson(value);
    return null;
  };

  const actorId = uuidField('actorId');
  const targetId = uuidField('targetId');

  let actorType: AuditActorType = 'system';
  const rawActorType = raw['actorType'];
  if ((ACTOR_TYPES as readonly unknown[]).includes(rawActorType)) {
    actorType = rawActorType as AuditActorType;
  } else if (rawActorType !== undefined && rawActorType !== null) {
    invalid['actorType'] = toJson(rawActorType);
  }

  let sourceIp: string | null = null;
  const rawIp = raw['sourceIp'];
  if (typeof rawIp === 'string' && isIP(rawIp) !== 0) sourceIp = rawIp;
  else if (rawIp !== undefined && rawIp !== null) invalid['sourceIp'] = toJson(rawIp);

  const action = text(raw['action']);
  const targetType = text(raw['targetType']);
  if (action === null) invalid['action'] = toJson(raw['action']);
  if (targetType === null && raw['targetType'] !== undefined) {
    invalid['targetType'] = toJson(raw['targetType']);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key) && value !== undefined) context[key] = toJson(value);
  }
  if (Object.keys(invalid).length > 0) context['_invalid'] = invalid;

  let after = toJson(raw['after']);
  if (Object.keys(context).length > 0) {
    after =
      after === null
        ? { _context: context }
        : isRecord(after)
          ? { ...after, _context: context }
          : { value: after, _context: context };
  }

  return {
    actorId,
    actorType,
    action: action ?? 'unknown',
    targetType: targetType ?? 'unknown',
    targetId,
    before: toJson(raw['before']),
    after,
    reason: text(raw['reason']),
    sourceIp,
    requestId: text(raw['requestId']),
  };
}

/**
 * Deterministic serialisation: object keys sorted at every depth, no
 * whitespace, dates as UTC ISO-8601. Absent and null are not distinguishable in
 * JSON, so `chainPayload` always emits every field, with `null` for absent.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const record = value as Record<string, unknown>;
      const members: string[] = [];
      for (const key of Object.keys(record).sort()) {
        if (record[key] !== undefined) {
          members.push(`${JSON.stringify(key)}:${canonicalize(record[key])}`);
        }
      }
      return `{${members.join(',')}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

export interface ChainPosition {
  readonly organizationId: string;
  readonly stream: 'access' | 'activity';
  readonly sequence: bigint;
  readonly occurredAt: Date;
}

/** The exact field set §9.5 hashes. */
export function chainPayload(position: ChainPosition, entry: AuditEntryInput): string {
  return canonicalize({
    organizationId: position.organizationId,
    stream: position.stream,
    sequence: position.sequence.toString(),
    occurredAt: position.occurredAt,
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    sourceIp: entry.sourceIp,
    requestId: entry.requestId,
  });
}

/** `hash = sha256(prevHash || payload)`; the first entry chains from nothing. */
export function computeHash(prevHash: Buffer | null, payload: string): Buffer {
  return createHash('sha256')
    .update(prevHash ?? Buffer.alloc(0))
    .update(payload, 'utf8')
    .digest();
}

export interface StoredChainEntry extends ChainPosition, AuditEntryInput {
  readonly prevHash: Buffer | null;
  readonly hash: Buffer;
}

export interface ChainBreak {
  readonly sequence: bigint;
  readonly reason: 'sequence-gap' | 'prev-hash-mismatch' | 'hash-mismatch';
}

/**
 * Verifies stored entries, oldest first, against the recomputed chain
 * (AU-L6: monotonic sequence, correct `prev_hash`, correct `hash`).
 * `expectedFirst` lets a caller verify a window that starts mid-chain.
 */
export function verifyChain(
  entries: readonly StoredChainEntry[],
  expectedFirst: { sequence: bigint; prevHash: Buffer | null } = { sequence: 1n, prevHash: null },
): ChainBreak[] {
  const breaks: ChainBreak[] = [];
  let sequence = expectedFirst.sequence;
  let prevHash = expectedFirst.prevHash;

  for (const entry of entries) {
    if (entry.sequence !== sequence) {
      breaks.push({ sequence: entry.sequence, reason: 'sequence-gap' });
    }
    const linked = (entry.prevHash === null && prevHash === null) ||
      (entry.prevHash !== null && prevHash !== null && entry.prevHash.equals(prevHash));
    if (!linked) breaks.push({ sequence: entry.sequence, reason: 'prev-hash-mismatch' });
    if (!computeHash(entry.prevHash, chainPayload(entry, entry)).equals(entry.hash)) {
      breaks.push({ sequence: entry.sequence, reason: 'hash-mismatch' });
    }
    // Continue from what is stored, so one tampered row is reported once
    // rather than cascading a mismatch through every later entry.
    sequence = entry.sequence + 1n;
    prevHash = entry.hash;
  }
  return breaks;
}
