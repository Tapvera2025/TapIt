import { ProviderError } from '../errors.js';
import {
  cleanEmail,
  cleanText,
  compact,
  directionFrom,
  externalId,
  isRecord,
  nameList,
  normalizePhone,
  parseTimestamp,
  phoneList,
} from '../normalize.js';
import type { AircallCredentials, CallOutcome, CallWindow, NormalizedAgent, NormalizedCall } from '../types.js';
import { LOCAL_HOSTS, providerBaseUrl, providerJson, providerRequest, type ProviderHttpOptions, type RequestBudget } from './http.js';
import type { CallPageHandler, TelephonyClient } from './index.js';

/**
 * Aircall Public API — https://developer.aircall.io/api-references/
 *
 *   Auth      HTTP Basic, api_id:api_token
 *   Ping      GET /v1/ping → { ping: "pong" }
 *   Users     GET /v2/users (User V1 endpoints were retired on 30 Sep 2026);
 *             falls back to /v1/users for accounts still on V1.
 *   Calls     GET /v1/calls  from / to (UNIX seconds), order, page, per_page ≤ 50,
 *             fetch_contact. A query returns at most 10,000 calls, so the sync
 *             moves `from` forward instead of paging past that.
 *   Recording GET /v1/calls/:id → `recording` / `voicemail` (short-lived signed URLs)
 *   Limits    120 requests per minute per company; 429 on excess.
 */

const DEFAULT_BASE = 'https://api.aircall.io';
const API_HOSTS = ['api.aircall.io', ...LOCAL_HOSTS];
const RECORDING_HOSTS = ['.amazonaws.com', '.aircall.io', '.cloudfront.net', ...LOCAL_HOSTS];
const PAGE_SIZE = 50;
/** 10,000 calls per query ÷ 50 per page. */
const MAX_PAGES_PER_QUERY = 200;

/** Aircall's missed-call reasons that mean the caller gave up. */
const ABANDONED_REASONS = new Set(['short_abandoned', 'abandoned_in_ivr', 'abandoned_in_classic']);

function itemsOf(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return [];
  for (const candidate of [key, 'data', 'items']) {
    if (Array.isArray(body[candidate])) return body[candidate] as unknown[];
  }
  return [];
}

function nextLink(body: unknown, current: URL): URL | null {
  if (!isRecord(body)) return null;
  const meta = isRecord(body['meta']) ? body['meta'] : body;
  const raw = meta['next_page_link'] ?? meta['next_page_url'] ?? meta['next'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const next = new URL(raw, current);
    return next.hostname === current.hostname && next.pathname === current.pathname ? next : null;
  } catch {
    return null;
  }
}

function personName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const full = cleanText(value['name'], 200);
  if (full) return full;
  const parts = [cleanText(value['first_name'], 100), cleanText(value['last_name'], 100)].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function firstEmail(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const direct = cleanEmail(value['email']);
  if (direct) return direct;
  const emails = value['emails'];
  if (Array.isArray(emails)) {
    for (const item of emails) {
      const email = cleanEmail(isRecord(item) ? item['value'] : item);
      if (email) return email;
    }
  }
  return null;
}

export function normalizeAircallUser(raw: unknown): NormalizedAgent | null {
  if (!isRecord(raw)) return null;
  const id = externalId(raw['id'] ?? raw['user_id']);
  if (!id) return null;
  return {
    externalId: id,
    name: personName(raw),
    email: cleanEmail(raw['email']),
    role: cleanText(raw['role'] ?? (Array.isArray(raw['roles']) ? nameList(raw['roles']).join(', ') : null), 80),
    extension: cleanText(raw['extension'], 40),
    timeZone: cleanText(raw['time_zone'] ?? raw['timezone'], 80),
    phoneNumbers: phoneList(raw['numbers']),
    groups: nameList(raw['teams']),
    isActive: !(raw['deleted'] === true || raw['active'] === false),
    metadata: compact({
      availabilityStatus: raw['availability_status'],
      substatus: raw['substatus'],
      language: raw['language'],
      wrapUpTime: raw['wrap_up_time'],
      createdAt: raw['created_at'],
    }) as Record<string, unknown>,
  };
}

function aircallOutcome(raw: Record<string, unknown>, direction: 'inbound' | 'outbound', answeredAt: Date | null): CallOutcome {
  if (cleanText(raw['voicemail'], 2000) || cleanText(raw['voicemail_short_url'], 2000)) return 'voicemail';
  if (answeredAt) return 'answered';
  if (direction === 'outbound') return 'unanswered';
  const reason = cleanText(raw['missed_call_reason'], 80)?.toLowerCase() ?? '';
  return ABANDONED_REASONS.has(reason) ? 'abandoned' : 'missed';
}

export function normalizeAircallCall(raw: unknown): NormalizedCall | null {
  if (!isRecord(raw)) return null;
  const id = externalId(raw['id']);
  const startedAt = parseTimestamp(raw['started_at']);
  if (!id || !startedAt) return null;
  const direction = directionFrom(raw['direction']) ?? 'inbound';
  const answeredAt = parseTimestamp(raw['answered_at']);
  const endedAt = parseTimestamp(raw['ended_at']);
  const outcome = aircallOutcome(raw, direction, answeredAt);
  const reportedDuration = typeof raw['duration'] === 'number' ? Math.max(0, Math.round(raw['duration'])) : null;
  const durationSeconds =
    reportedDuration ?? (endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : 0);
  const talkSeconds =
    answeredAt && endedAt ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000)) : 0;
  const ringSeconds = answeredAt ? Math.max(0, Math.round((answeredAt.getTime() - startedAt.getTime()) / 1000)) : null;

  const user = isRecord(raw['user']) ? raw['user'] : isRecord(raw['assigned_to']) ? raw['assigned_to'] : null;
  const userId = user ? externalId(user['id']) : null;
  const number = isRecord(raw['number']) ? raw['number'] : {};
  const contact = isRecord(raw['contact']) ? raw['contact'] : null;
  const comments = Array.isArray(raw['comments']) ? raw['comments'] : [];
  const notes = comments
    .map((comment) => (isRecord(comment) ? cleanText(comment['content'], 2000) : null))
    .filter((text): text is string => text !== null)
    .join('\n\n');
  const person = (value: unknown) =>
    isRecord(value) ? { id: externalId(value['id']), name: personName(value), email: cleanEmail(value['email']) } : null;

  return {
    externalId: id,
    agent: userId ? { externalId: userId, name: personName(user), email: cleanEmail(user?.['email']) } : null,
    direction,
    outcome,
    providerStatus: cleanText(raw['status'], 40),
    missedReason: cleanText(raw['missed_call_reason'], 120),
    startedAt,
    answeredAt,
    endedAt,
    durationSeconds,
    talkSeconds,
    ringSeconds,
    holdSeconds: null,
    queueWaitSeconds: null,
    wrapUpSeconds: null,
    contactNumber: normalizePhone(raw['raw_digits']),
    contactName: personName(contact),
    contactEmail: firstEmail(contact),
    businessNumber: normalizePhone(number['digits']),
    businessNumberName: cleanText(number['name'], 200),
    hasRecording: Boolean(cleanText(raw['recording'], 4000) || cleanText(raw['asset'], 4000) || cleanText(raw['recording_short_url'], 4000)),
    hasVoicemail: outcome === 'voicemail',
    notes: notes ? cleanText(notes, 8000) : null,
    disposition: null,
    tags: nameList(raw['tags']),
    rating: null,
    aiSummary: null,
    aiSentiment: null,
    aiScore: null,
    providerLink: null,
    metadata: compact({
      sid: raw['sid'],
      status: raw['status'],
      archived: raw['archived'],
      cost: raw['cost'],
      country: number['country'],
      numberTimeZone: number['time_zone'],
      teams: nameList(raw['teams']),
      assignedTo: person(raw['assigned_to']),
      transferredBy: person(raw['transferred_by']),
      transferredTo: person(raw['transferred_to']),
      ivrOptionsSelected: raw['ivr_options_selected'],
      participants: raw['participants'],
    }) as Record<string, unknown>,
  };
}

export class AircallClient implements TelephonyClient {
  readonly provider = 'aircall' as const;
  private readonly base: string;
  private readonly options: ProviderHttpOptions;

  constructor(
    credentials: AircallCredentials,
    overrides: { budget?: RequestBudget; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.base = providerBaseUrl('aircall', DEFAULT_BASE);
    const basic = Buffer.from(`${credentials.apiId.trim()}:${credentials.apiToken.trim()}`, 'utf8').toString('base64');
    this.options = {
      provider: 'aircall',
      allowedHosts: API_HOSTS,
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'User-Agent': 'TapCRM-CallAnalytics/1.0',
      },
      budget: overrides.budget,
      ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
      ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
    };
  }

  private url(path: string, query: Record<string, string | number | boolean> = {}): URL {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    return url;
  }

  async verify(): Promise<{ accountLabel: string | null }> {
    const body = await providerJson(this.url('/v1/ping'), this.options);
    if (!isRecord(body)) {
      throw new ProviderError('Aircall answered with an unexpected response. Check the API ID and token.', 'invalid-response', 200);
    }
    return { accountLabel: null };
  }

  private async pageUsers(path: string): Promise<NormalizedAgent[]> {
    const agents = new Map<string, NormalizedAgent>();
    let url: URL | null = this.url(path, { page: 1, per_page: PAGE_SIZE });
    let page = 1;
    const seen = new Set<string>();
    while (url && page <= MAX_PAGES_PER_QUERY) {
      if (seen.has(url.toString())) break;
      seen.add(url.toString());
      const body = await providerJson(url, this.options);
      const rows = itemsOf(body, 'users');
      for (const row of rows) {
        const agent = normalizeAircallUser(row);
        if (agent) agents.set(agent.externalId, agent);
      }
      page += 1;
      url = nextLink(body, url) ?? (rows.length >= PAGE_SIZE ? this.url(path, { page, per_page: PAGE_SIZE }) : null);
    }
    return [...agents.values()];
  }

  async listAgents(): Promise<NormalizedAgent[]> {
    try {
      return await this.pageUsers('/v2/users');
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-found') return this.pageUsers('/v1/users');
      throw error;
    }
  }

  async listCalls(window: CallWindow, onPage: CallPageHandler): Promise<void> {
    let from = Math.floor(window.from.getTime() / 1000);
    const to = Math.ceil(window.to.getTime() / 1000);
    // Each pass is one query of at most 10,000 calls; the next pass starts
    // at the last call seen. The page handler's upsert absorbs the overlap.
    for (let pass = 0; pass < 20; pass += 1) {
      const query = (page: number) => ({ from, to, order: 'asc', page, per_page: PAGE_SIZE, fetch_contact: true });
      let url: URL | null = this.url('/v1/calls', query(1));
      let page = 1;
      let lastStarted: number | null = null;
      const seen = new Set<string>();
      while (url && page <= MAX_PAGES_PER_QUERY) {
        if (seen.has(url.toString())) break;
        seen.add(url.toString());
        const body = await providerJson(url, this.options);
        const rows = itemsOf(body, 'calls');
        const calls = rows.map(normalizeAircallCall).filter((call): call is NormalizedCall => call !== null);
        await onPage(calls, rows.length);
        for (const call of calls) lastStarted = Math.max(lastStarted ?? 0, Math.floor(call.startedAt.getTime() / 1000));
        page += 1;
        url = nextLink(body, url) ?? (rows.length >= PAGE_SIZE ? this.url('/v1/calls', query(page)) : null);
      }
      // Fewer than 10,000 calls in this pass: everything up to `to` is in.
      if (page <= MAX_PAGES_PER_QUERY || lastStarted === null || lastStarted <= from) return;
      from = lastStarted;
    }
  }

  async fetchRecording(callExternalId: string): Promise<Response> {
    const body = await providerJson(this.url(`/v1/calls/${encodeURIComponent(callExternalId)}`), { ...this.options, budget: undefined });
    const call = isRecord(body) && isRecord(body['call']) ? body['call'] : isRecord(body) ? body : {};
    const link = cleanText(call['recording'], 4000) ?? cleanText(call['voicemail'], 4000);
    if (!link) throw new ProviderError('Aircall has no recording or voicemail for this call.', 'not-found', 404);
    // A pre-signed storage link: fetched without the API credentials.
    return providerRequest(new URL(link), {
      provider: 'aircall',
      allowedHosts: RECORDING_HOSTS,
      headers: { Accept: 'audio/*' },
      timeoutMs: 60_000,
      redirectHosts: RECORDING_HOSTS,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }
}
