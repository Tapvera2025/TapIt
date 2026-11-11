import type { CallDirection, CallOutcome } from './types.js';

/**
 * Small, pure conversions shared by the JustCall and Aircall adapters.
 * Provider payloads are untrusted JSON: every helper accepts `unknown` and
 * returns null rather than throwing on a shape it does not recognise.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cleanText(value: unknown, max = 4000): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function cleanEmail(value: unknown): string | null {
  const text = cleanText(value, 320);
  if (!text) return null;
  const lowered = text.toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(lowered) ? lowered : null;
}

/** A provider id (number or string) as text. */
export function externalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return cleanText(value, 200);
}

export function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value));
  return null;
}

/**
 * Seconds from a number, a numeric string, or a clock string ("01:02:03",
 * "02:03"). Negative values are treated as absent.
 */
export function toSeconds(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(text);
  if (!clock) return null;
  const hours = Number(clock[1] ?? 0);
  const minutes = Number(clock[2]);
  const seconds = Number(clock[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * A phone number as "+<digits>" when it carries a country code, otherwise the
 * bare digits. Formatting characters are dropped so the same number written
 * two ways compares equal.
 */
export function normalizePhone(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : cleanText(value, 64);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 3) return null;
  if (text.trim().startsWith('+')) return `+${digits}`;
  if (text.trim().startsWith('00') && digits.length > 4) return `+${digits.slice(2)}`;
  return digits.length >= 11 ? `+${digits}` : digits;
}

/** "YYYY-MM-DD" + "HH:mm:ss", both in UTC. */
export function parseUtcDateTime(date: unknown, time: unknown): Date | null {
  const day = cleanText(date, 20);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = cleanText(time, 20) ?? '00:00:00';
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(clock)) return null;
  const parsed = new Date(`${day}T${clock.length === 5 ? `${clock}:00` : clock}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** UNIX seconds (number or numeric string), or an ISO 8601 string. */
export function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    // Milliseconds slip through some exports; anything past year 5000 in
    // seconds is really milliseconds.
    const parsed = new Date(seconds > 1e11 ? seconds : seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** "YYYY-MM-DD HH:mm:ss" in UTC — the date-time format JustCall filters take. */
export function formatProviderDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

export function directionFrom(value: unknown): CallDirection | null {
  const text = cleanText(value, 40)?.toLowerCase();
  if (!text) return null;
  if (text.startsWith('in')) return 'inbound';
  if (text.startsWith('out')) return 'outbound';
  return null;
}

/**
 * Maps a provider's call result label ("Answered", "INCOMING_MISSED",
 * "Abandoned before ringing", "Unanswered", …) onto the CRM's outcomes.
 * Order matters: "unanswered" contains "answered".
 */
export function outcomeFromLabel(label: string | null, direction: CallDirection): CallOutcome {
  const text = (label ?? '').toLowerCase().replace(/[_-]+/g, ' ');
  if (!text.trim()) return 'other';
  if (text.includes('voicemail') || text.includes('voice mail')) return 'voicemail';
  if (text.includes('unanswered') || text.includes('not answered') || text.includes('no answer')) {
    return direction === 'inbound' ? 'missed' : 'unanswered';
  }
  if (text.includes('abandon')) return 'abandoned';
  if (text.includes('missed')) return 'missed';
  if (text.includes('busy')) return 'busy';
  if (text.includes('fail') || text.includes('restricted') || text.includes('blocked')) return 'failed';
  if (text.includes('cancel')) return direction === 'inbound' ? 'missed' : 'unanswered';
  if (text.includes('answer') || text.includes('completed') || text.includes('connected')) return 'answered';
  return 'other';
}

/**
 * Names from whatever a provider sends for groups, tags or teams: strings,
 * objects with a name/label/title, or an id → name map.
 */
export function nameList(value: unknown, max = 25): string[] {
  const names: string[] = [];
  const push = (candidate: unknown) => {
    const text = cleanText(candidate, 120);
    if (text && !names.includes(text)) names.push(text);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) push(item['name'] ?? item['label'] ?? item['title'] ?? item['group_name'] ?? item['tag']);
      else push(item);
    }
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) {
      if (isRecord(item)) push(item['name'] ?? item['label'] ?? item['title'] ?? item['group_name']);
      else push(item);
    }
  } else {
    push(value);
  }
  return names.slice(0, max);
}

export function phoneList(value: unknown, max = 25): string[] {
  const numbers: string[] = [];
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : value === undefined || value === null ? [] : [value];
  for (const item of items) {
    const raw = isRecord(item) ? (item['digits'] ?? item['number'] ?? item['phone_number']) : item;
    const phone = normalizePhone(raw);
    if (phone && !numbers.includes(phone)) numbers.push(phone);
  }
  return numbers.slice(0, max);
}

/** A bounded copy of a provider value for the metadata column. */
export function compact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 1999)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => compact(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      const next = compact(item, depth + 1);
      if (next !== null && next !== '') out[key] = next;
    }
    return out;
  }
  return null;
}
