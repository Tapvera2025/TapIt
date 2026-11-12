import { ProviderError } from '../errors.js';
import {
  cleanEmail,
  cleanText,
  compact,
  directionFrom,
  externalId,
  formatProviderDateTime,
  isRecord,
  nameList,
  normalizePhone,
  outcomeFromLabel,
  parseUtcDateTime,
  phoneList,
  toInteger,
  toSeconds,
} from '../normalize.js';
import type { CallWindow, JustCallCredentials, NormalizedAgent, NormalizedCall } from '../types.js';
import { LOCAL_HOSTS, providerBaseUrl, providerJson, providerRequest, type ProviderHttpOptions, type RequestBudget } from './http.js';
import type { CallPageHandler, TelephonyClient } from './index.js';

/**
 * JustCall API v2.1 — https://developer.justcall.io/reference
 *
 *   Auth      `Authorization: <api_key>:<api_secret>` (Team plan or higher)
 *   Users     GET /v2.1/users          page from 0, per_page ≤ 100
 *   Calls     GET /v2.1/calls          from_datetime / to_datetime, per_page ≤ 100,
 *                                      order, sort=datetime, fetch_ai_data, fetch_queue_data
 *   Recording GET /v2.1/calls/{id}/recording/download
 *   Limits    Team 30 req/min (1,800/h), Pro 60/min, Business 90/min; 429 on excess.
 *             Calls are available for the last 3 months.
 *
 * Since v2.1 the date filters are clock times in the account's own timezone,
 * which the API does not report, and a to_datetime in the future is refused
 * (400). See `justCallDateFilters`.
 */

const DEFAULT_BASE = 'https://api.justcall.io';
const API_HOSTS = ['api.justcall.io', ...LOCAL_HOSTS];
/** Where /recording/download may hand the audio off to. */
const RECORDING_HOSTS = ['.justcall.io', '.amazonaws.com', '.cloudfront.net', '.googleapis.com', ...LOCAL_HOSTS];
const PAGE_SIZE = 100;
/** Every UTC offset in use lies between −12:00 and +14:00. */
const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;
/** JustCall keeps three months of calls behind its API. */
export const JUSTCALL_HISTORY_DAYS = 90;

/**
 * The /v2.1/calls date filters for a window. JustCall reads both as clock
 * times in the account's timezone, so a UTC time is off by the account's offset:
 *
 *   - from_datetime is moved 14 hours earlier, which reaches the window's start
 *     whatever the offset; the upsert absorbs the extra calls.
 *   - to_datetime is left out when the window runs up to now, so JustCall
 *     returns calls up to now. Sending the time now (let alone later) is refused
 *     as "in the future" by accounts behind UTC. An end a day or more back is
 *     sent 14 hours later, which covers it and is past in every timezone.
 */
export function justCallDateFilters(window: CallWindow, now: number): { from_datetime: string; to_datetime?: string } {
  const earliest = now - JUSTCALL_HISTORY_DAYS * 86_400_000;
  const from = formatProviderDateTime(new Date(Math.max(window.from.getTime() - MAX_AHEAD_OF_UTC_MS, earliest)));
  const end = window.to.getTime() + MAX_AHEAD_OF_UTC_MS;
  if (end + MAX_BEHIND_UTC_MS > now) return { from_datetime: from };
  return { from_datetime: from, to_datetime: formatProviderDateTime(new Date(end)) };
}

function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body['data'])) return body['data'] as unknown[];
  return [];
}

function nextLink(body: unknown, current: URL): URL | null {
  if (!isRecord(body)) return null;
  const raw = body['next_page_link'] ?? body['next_page_url'] ?? body['next'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const next = new URL(raw, current);
    // Only follow a link that stays on the same API host and path.
    return next.hostname === current.hostname && next.pathname === current.pathname ? next : null;
  } catch {
    return null;
  }
}

/** JustCall AI summaries arrive as text or as an object of labelled parts. */
function summaryText(value: unknown): string | null {
  if (typeof value === 'string') return cleanText(value, 8000);
  if (Array.isArray(value)) return cleanText(value.filter((part) => typeof part === 'string').join('\n'), 8000);
  if (isRecord(value)) {
    const parts = Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
      .map(([key, text]) => `${key.replace(/_/g, ' ')}: ${text.trim()}`);
    return cleanText(parts.join('\n'), 8000);
  }
  return null;
}

export function normalizeJustCallUser(raw: unknown): NormalizedAgent | null {
  if (!isRecord(raw)) return null;
  const id = externalId(raw['id'] ?? raw['agent_id'] ?? raw['user_id']);
  if (!id) return null;
  const numbers = [...phoneList(raw['owned_numbers']), ...phoneList(raw['shared_numbers'])];
  return {
    externalId: id,
    name: cleanText(raw['name'], 200),
    email: cleanEmail(raw['email']),
    role: cleanText(raw['role'], 80),
    extension: cleanText(raw['extension'], 40),
    timeZone: cleanText(raw['timezone'] ?? raw['time_zone'], 80),
    phoneNumbers: [...new Set(numbers)],
    groups: nameList(raw['groups']),
    isActive: !(raw['active'] === false || raw['agent_active'] === false),
    metadata: compact({
      available: raw['available'],
      onCall: raw['on_call'],
      unavailabilityReason: raw['unavailability_reason'],
      workingHoursType: raw['working_hours_type'],
      lastLoginAt: raw['last_login_timestamp'],
      createdAt: raw['created_at'],
    }) as Record<string, unknown>,
  };
}

export function normalizeJustCallCall(raw: unknown): NormalizedCall | null {
  if (!isRecord(raw)) return null;
  const id = externalId(raw['id'] ?? raw['call_sid']);
  const combined = cleanText(raw['datetime'], 40);
  const startedAt =
    parseUtcDateTime(raw['call_date'], raw['call_time']) ??
    (combined ? parseUtcDateTime(combined.slice(0, 10), combined.slice(11, 19)) : null);
  if (!id || !startedAt) return null;

  const info = isRecord(raw['call_info']) ? raw['call_info'] : {};
  const durations = isRecord(raw['call_duration']) ? raw['call_duration'] : {};
  const ai = isRecord(raw['justcall_ai']) ? raw['justcall_ai'] : {};
  const queue = isRecord(raw['queue_callback']) ? raw['queue_callback'] : null;
  const ivr = isRecord(raw['ivr_info']) ? raw['ivr_info'] : null;

  const typeLabel = cleanText(info['type'] ?? raw['call_type'], 80);
  const direction =
    directionFrom(info['direction'] ?? raw['direction']) ??
    (typeLabel?.toUpperCase().startsWith('INCOMING') ? 'inbound' : 'outbound');
  const outcome = outcomeFromLabel(typeLabel, direction);

  const durationSeconds =
    toSeconds(durations['total_duration']) ??
    toSeconds(durations['friendly_duration']) ??
    toSeconds(raw['call_duration']) ??
    0;
  const conversation = toSeconds(durations['conversation_time']);
  const talkSeconds = conversation ?? (outcome === 'answered' ? durationSeconds : 0);
  const recording = cleanText(info['recording'], 2000);
  const voicemailTranscript = cleanText(info['voicemail_transcription'], 4000);

  const agentId = externalId(raw['agent_id']);
  const summary = ai['call_summary'];
  const rawScore = ai['call_score'];
  const score = typeof rawScore === 'number' || typeof rawScore === 'string' ? Number(rawScore) : Number.NaN;

  return {
    externalId: id,
    agent: agentId
      ? { externalId: agentId, name: cleanText(raw['agent_name'], 200), email: cleanEmail(raw['agent_email']) }
      : null,
    direction,
    outcome,
    providerStatus: typeLabel,
    missedReason: cleanText(info['missed_call_reason'], 200),
    startedAt,
    answeredAt: null,
    endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
    durationSeconds,
    talkSeconds,
    ringSeconds: toSeconds(durations['ring_time']),
    holdSeconds: toSeconds(durations['hold_time']),
    queueWaitSeconds: toSeconds(durations['queue_wait_time']),
    wrapUpSeconds: toSeconds(durations['wrap_up_time']),
    contactNumber: normalizePhone(raw['contact_number']),
    contactName: cleanText(raw['contact_name'], 200),
    contactEmail: cleanEmail(raw['contact_email']),
    businessNumber: normalizePhone(raw['justcall_number']),
    businessNumberName: cleanText(raw['justcall_line_name'], 200),
    hasRecording: Boolean(recording) && outcome !== 'voicemail',
    hasVoicemail: outcome === 'voicemail' && Boolean(recording),
    notes: cleanText(info['notes'], 8000),
    disposition: cleanText(info['disposition'], 200),
    tags: nameList(ai['tags'] ?? raw['tags']),
    rating: toInteger(info['rating']),
    aiSummary: summaryText(summary),
    aiSentiment: cleanText(ai['customer_sentiment'], 40),
    aiScore: Number.isFinite(score) && rawScore !== '' ? Math.round(score * 100) / 100 : null,
    providerLink: null,
    metadata: compact({
      callSid: raw['call_sid'],
      callTraits: info['call_traits'],
      status: info['status'],
      handleSeconds: toSeconds(durations['handle_time']),
      friendlyDuration: durations['friendly_duration'],
      voicemailTranscription: voicemailTranscript,
      hasChildRecording: Boolean(cleanText(info['recording_child'], 2000)),
      agentActive: raw['agent_active'],
      callUserDate: raw['call_user_date'],
      callUserTime: raw['call_user_time'],
      costIncurred: raw['cost_incurred'],
      ivr,
      queueCallback: queue,
      callScoreParameters: ai['call_score_parameters'],
      manualCallScore: ai['manual_call_score'],
    }) as Record<string, unknown>,
  };
}

export class JustCallClient implements TelephonyClient {
  readonly provider = 'justcall' as const;
  private readonly base: string;
  private readonly options: ProviderHttpOptions;

  constructor(
    credentials: JustCallCredentials,
    overrides: { budget?: RequestBudget; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.base = providerBaseUrl('justcall', DEFAULT_BASE);
    this.options = {
      provider: 'justcall',
      allowedHosts: API_HOSTS,
      headers: {
        Authorization: `${credentials.apiKey.trim()}:${credentials.apiSecret.trim()}`,
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
    const body = await providerJson(this.url('/v2.1/users', { page: 0, per_page: 1 }), this.options);
    if (!isRecord(body) && !Array.isArray(body)) {
      throw new ProviderError('JustCall answered with an unexpected response. Check the API key and secret.', 'invalid-response', 200);
    }
    return { accountLabel: null };
  }

  async listAgents(): Promise<NormalizedAgent[]> {
    const agents = new Map<string, NormalizedAgent>();
    let url: URL | null = this.url('/v2.1/users', { page: 0, per_page: PAGE_SIZE, order: 'asc' });
    let page = 0;
    const seen = new Set<string>();
    while (url && page < 200) {
      if (seen.has(url.toString())) break;
      seen.add(url.toString());
      const body = await providerJson(url, this.options);
      const rows = listOf(body);
      for (const row of rows) {
        const agent = normalizeJustCallUser(row);
        if (agent) agents.set(agent.externalId, agent);
      }
      page += 1;
      url = nextLink(body, url) ?? (rows.length >= PAGE_SIZE ? this.url('/v2.1/users', { page, per_page: PAGE_SIZE, order: 'asc' }) : null);
    }
    return [...agents.values()];
  }

  async listCalls(window: CallWindow, onPage: CallPageHandler): Promise<void> {
    const dates = justCallDateFilters(window, Date.now());
    const query = (page: number) => ({
      ...dates,
      page,
      per_page: PAGE_SIZE,
      order: 'asc',
      sort: 'datetime',
      fetch_ai_data: true,
      fetch_queue_data: true,
    });
    let url: URL | null = this.url('/v2.1/calls', query(0));
    let page = 0;
    const seen = new Set<string>();
    while (url) {
      if (seen.has(url.toString())) break;
      seen.add(url.toString());
      const body = await providerJson(url, this.options);
      const rows = listOf(body);
      const calls = rows.map(normalizeJustCallCall).filter((call): call is NormalizedCall => call !== null);
      await onPage(calls, rows.length);
      page += 1;
      url = nextLink(body, url) ?? (rows.length >= PAGE_SIZE ? this.url('/v2.1/calls', query(page)) : null);
    }
  }

  async fetchRecording(callExternalId: string): Promise<Response> {
    const url = this.url(`/v2.1/calls/${encodeURIComponent(callExternalId)}/recording/download`);
    return providerRequest(url, { ...this.options, budget: undefined, timeoutMs: 60_000, redirectHosts: RECORDING_HOSTS });
  }
}
