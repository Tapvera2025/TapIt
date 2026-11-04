import { describe, expect, it } from 'vitest';
import { ProviderError, SyncBudgetExhausted } from '../errors.js';
import type { NormalizedCall } from '../types.js';
import { createBudget } from './http.js';
import { JustCallClient, justCallDateFilters, normalizeJustCallCall, normalizeJustCallUser } from './justcall.js';

/** A JustCall v2.1 call object, as documented (developer.justcall.io, "JustCall Call Object"). */
const CALL = {
  id: 9876543,
  call_sid: 'CA1234567890abcdef',
  contact_number: '+91 98765 43210',
  contact_name: 'Rahul Shah',
  contact_email: 'Rahul@Example.com',
  justcall_number: '+1 415 555 0100',
  justcall_line_name: 'India Sales',
  agent_id: 4321,
  agent_name: 'Asha Rao',
  agent_email: 'Asha.Rao@Tapvera.com',
  agent_active: true,
  call_date: '2026-10-30',
  call_time: '09:15:00',
  call_user_date: '2026-10-30',
  call_user_time: '14:45:00',
  cost_incurred: 0.02,
  call_info: {
    direction: 'Incoming',
    type: 'Answered',
    missed_call_reason: '',
    status: 'Unarchived',
    disposition: 'Sales: Follow Up',
    notes: 'Wants a demo next week',
    rating: 4,
    recording: 'https://recordings.justcall.io/abc.mp3',
    recording_child: '',
    voicemail_transcription: '',
    call_traits: ['Queue'],
  },
  call_duration: {
    friendly_duration: '00:05:10',
    queue_wait_time: 12,
    ring_time: 8,
    hold_time: 30,
    wrap_up_time: 20,
    total_duration: 310,
    conversation_time: 260,
    handle_time: 280,
  },
  justcall_ai: {
    call_summary: 'Customer asked for pricing and a demo.',
    customer_sentiment: 'Positive',
    call_score: 82.5,
    tags: ['pricing', 'demo'],
  },
};

const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('JustCall call normalization', () => {
  it('maps a documented call object onto the CRM call', () => {
    const call = normalizeJustCallCall(CALL)!;
    expect(call.externalId).toBe('9876543');
    expect(call.agent).toEqual({ externalId: '4321', name: 'Asha Rao', email: 'asha.rao@tapvera.com' });
    expect(call.direction).toBe('inbound');
    expect(call.outcome).toBe('answered');
    expect(call.startedAt.toISOString()).toBe('2026-10-30T09:15:00.000Z');
    expect(call.endedAt?.toISOString()).toBe('2026-10-30T09:20:10.000Z');
    expect(call.durationSeconds).toBe(310);
    expect(call.talkSeconds).toBe(260);
    expect(call.ringSeconds).toBe(8);
    expect(call.holdSeconds).toBe(30);
    expect(call.queueWaitSeconds).toBe(12);
    expect(call.wrapUpSeconds).toBe(20);
    expect(call.contactNumber).toBe('+919876543210');
    expect(call.contactEmail).toBe('rahul@example.com');
    expect(call.businessNumber).toBe('+14155550100');
    expect(call.businessNumberName).toBe('India Sales');
    expect(call.hasRecording).toBe(true);
    expect(call.hasVoicemail).toBe(false);
    expect(call.disposition).toBe('Sales: Follow Up');
    expect(call.notes).toBe('Wants a demo next week');
    expect(call.rating).toBe(4);
    expect(call.tags).toEqual(['pricing', 'demo']);
    expect(call.aiSummary).toBe('Customer asked for pricing and a demo.');
    expect(call.aiSentiment).toBe('Positive');
    expect(call.aiScore).toBe(82.5);
    expect(call.metadata).toMatchObject({ callSid: 'CA1234567890abcdef', callTraits: ['Queue'], costIncurred: 0.02 });
  });

  it('treats a voicemail recording as a voicemail, not a call recording', () => {
    const call = normalizeJustCallCall({
      ...CALL,
      call_info: { ...CALL.call_info, type: 'Voicemail', voicemail_transcription: 'Please call me back' },
      call_duration: { total_duration: 40 },
    })!;
    expect(call.outcome).toBe('voicemail');
    expect(call.hasVoicemail).toBe(true);
    expect(call.hasRecording).toBe(false);
    expect(call.talkSeconds).toBe(0);
    expect(call.metadata['voicemailTranscription']).toBe('Please call me back');
  });

  it('reads an outgoing unanswered call and falls back to the friendly duration', () => {
    const call = normalizeJustCallCall({
      ...CALL,
      call_info: { direction: 'Outgoing', type: 'Unanswered' },
      call_duration: { friendly_duration: '00:00:25' },
      justcall_ai: undefined,
    })!;
    expect(call.direction).toBe('outbound');
    expect(call.outcome).toBe('unanswered');
    expect(call.durationSeconds).toBe(25);
    expect(call.talkSeconds).toBe(0);
    expect(call.aiSummary).toBeNull();
  });

  it('flattens a structured AI summary', () => {
    const call = normalizeJustCallCall({ ...CALL, justcall_ai: { call_summary: { overview: 'Pricing call', next_steps: 'Send quote' } } })!;
    expect(call.aiSummary).toBe('overview: Pricing call\nnext steps: Send quote');
  });

  it('skips a call it cannot place in time', () => {
    expect(normalizeJustCallCall({ ...CALL, call_date: undefined, call_time: undefined })).toBeNull();
    expect(normalizeJustCallCall({ ...CALL, id: undefined, call_sid: undefined })).toBeNull();
    expect(normalizeJustCallCall('nope')).toBeNull();
  });

  it('maps a JustCall user', () => {
    const agent = normalizeJustCallUser({
      id: 4321,
      name: 'Asha Rao',
      email: 'ASHA.RAO@tapvera.com',
      role: 'Agent',
      extension: 101,
      groups: { 7: 'Inbound', 8: 'Renewals' },
      owned_numbers: ['+1 415 555 0100'],
      shared_numbers: ['+1 415 555 0199'],
      timezone: 'Asia/Kolkata',
      available: 'Yes',
      on_call: 'No',
    })!;
    expect(agent).toMatchObject({
      externalId: '4321',
      name: 'Asha Rao',
      email: 'asha.rao@tapvera.com',
      role: 'Agent',
      extension: '101',
      groups: ['Inbound', 'Renewals'],
      phoneNumbers: ['+14155550100', '+14155550199'],
      timeZone: 'Asia/Kolkata',
      isActive: true,
    });
  });
});

describe('JustCall date filters', () => {
  // JustCall reads the filters as clock times in the account's timezone (UTC−12 to UTC+14).
  const now = Date.UTC(2026, 10, 4, 9, 30, 0);
  const hours = (count: number) => count * 3_600_000;
  const readAt = (clock: string, offsetHours: number) => Date.parse(`${clock.replace(' ', 'T')}Z`) - hours(offsetHours);

  it('starts 14 hours early and leaves the end open for a window that runs up to now', () => {
    expect(justCallDateFilters({ from: new Date(now - hours(6)), to: new Date(now) }, now)).toEqual({
      from_datetime: '2026-11-03 13:30:00',
    });
  });

  it('never starts before the 90 days JustCall keeps', () => {
    expect(justCallDateFilters({ from: new Date(now - 200 * 86_400_000), to: new Date(now) }, now).from_datetime).toBe(
      '2026-08-06 09:30:00',
    );
  });

  it('bounds an older window so it is covered and past in every timezone', () => {
    expect(justCallDateFilters({ from: new Date(now - hours(72)), to: new Date(now - hours(48)) }, now).to_datetime).toBe(
      '2026-11-02 23:30:00',
    );
    for (let back = 0; back <= 72; back += 1) {
      const window = { from: new Date(now - hours(back + 6)), to: new Date(now - hours(back)) };
      const filters = justCallDateFilters(window, now);
      for (let offset = -12; offset <= 14; offset += 1) {
        expect(readAt(filters.from_datetime, offset)).toBeLessThanOrEqual(window.from.getTime());
        if (filters.to_datetime === undefined) continue;
        expect(readAt(filters.to_datetime, offset)).toBeLessThanOrEqual(now);
        expect(readAt(filters.to_datetime, offset)).toBeGreaterThanOrEqual(window.to.getTime());
      }
    }
  });
});

describe('JustCall client', () => {
  const credentials = { provider: 'justcall' as const, apiKey: 'key-1234567890', apiSecret: 'secret-abcdefgh' };

  it('sends the documented key:secret header and pages users until a short page', async () => {
    const requests: Array<{ url: URL; auth: string | null }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(urlOf(input));
      requests.push({ url, auth: new Headers(init?.headers).get('authorization') });
      const page = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('per_page'));
      const start = page * size;
      const ids = Array.from({ length: Math.max(0, Math.min(size, 130 - start)) }, (_, index) => start + index + 1);
      return jsonResponse({ status: 'success', count: ids.length, page, per_page: size, data: ids.map((id) => ({ id, name: `User ${id}`, email: `u${id}@x.io` })) });
    }) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    const agents = await client.listAgents();
    expect(agents).toHaveLength(130);
    expect(requests.map((request) => request.url.searchParams.get('page'))).toEqual(['0', '1']);
    expect(requests[0]!.auth).toBe('key-1234567890:secret-abcdefgh');
    expect(requests[0]!.url.pathname).toBe('/v2.1/users');
  });

  it('follows next_page_link on the calls endpoint and asks for AI and queue data', async () => {
    const seen: URL[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(urlOf(input));
      seen.push(url);
      if (url.searchParams.get('cursor') === '2') return jsonResponse({ data: [{ ...CALL, id: 2 }], next_page_link: null });
      return jsonResponse({ data: [{ ...CALL, id: 1 }], next_page_link: 'https://api.justcall.io/v2.1/calls?cursor=2' });
    }) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    const pages: NormalizedCall[][] = [];
    const now = Date.now();
    await client.listCalls({ from: new Date(now - 86_400_000), to: new Date(now) }, async (calls) => {
      pages.push([...calls]);
    });
    expect(pages.map((page) => page.map((call) => call.externalId))).toEqual([['1'], ['2']]);
    const first = seen[0]!;
    expect(first.pathname).toBe('/v2.1/calls');
    expect(first.searchParams.get('fetch_ai_data')).toBe('true');
    expect(first.searchParams.get('fetch_queue_data')).toBe('true');
    expect(first.searchParams.get('sort')).toBe('datetime');
    expect(first.searchParams.get('order')).toBe('asc');
    expect(first.searchParams.get('per_page')).toBe('100');
    expect(first.searchParams.get('from_datetime')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // The window runs up to now, so the end is left open rather than sent as a time JustCall may call future.
    expect(first.searchParams.has('to_datetime')).toBe(false);
  });

  it('passes JustCall’s reason for a 400 through as one sentence', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ status: 'error', message: 'to_datetime cannot be in the future.' }, { status: 400 })) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    await expect(client.listCalls({ from: new Date(Date.now() - 3_600_000), to: new Date() }, async () => undefined)).rejects.toMatchObject({
      kind: 'invalid-response',
      httpStatus: 400,
      message: 'JustCall returned an error (400): to_datetime cannot be in the future.',
    });
  });

  it('never follows a pagination link to another host', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ data: [CALL], next_page_link: 'https://evil.example.com/v2.1/calls?page=2' });
    }) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    await client.listCalls({ from: new Date(Date.now() - 3_600_000), to: new Date() }, async () => undefined);
    expect(calls).toBe(1);
  });

  it('turns 401 into a rejected-credentials error', async () => {
    const fetchImpl = (async () => jsonResponse({ message: 'Invalid API key' }, { status: 401 })) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    await expect(client.verify()).rejects.toMatchObject({ kind: 'rejected', httpStatus: 401 });
    await expect(client.verify()).rejects.toBeInstanceOf(ProviderError);
  });

  it('waits out a 429 using the burst reset header, then retries', async () => {
    const waits: number[] = [];
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      if (attempt === 1) return new Response('{}', { status: 429, headers: { 'x-rate-limit-burst-reset': '7' } });
      return jsonResponse({ data: [] });
    }) as typeof fetch;
    const client = new JustCallClient(credentials, {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await client.verify();
    expect(attempt).toBe(2);
    expect(waits).toEqual([7000]);
  });

  it('stops when the run budget is used up', async () => {
    const fetchImpl = (async () => jsonResponse({ data: Array.from({ length: 100 }, (_, index) => ({ ...CALL, id: index + 1 })) })) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl, budget: createBudget(3, 60_000) });
    let pages = 0;
    await expect(
      client.listCalls({ from: new Date(Date.now() - 3_600_000), to: new Date() }, async () => {
        pages += 1;
      }),
    ).rejects.toBeInstanceOf(SyncBudgetExhausted);
    expect(pages).toBe(3);
  });

  it('downloads a recording through the documented endpoint', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      seen.push(urlOf(input));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    const client = new JustCallClient(credentials, { fetchImpl });
    const response = await client.fetchRecording('9876543');
    expect(seen[0]).toBe('https://api.justcall.io/v2.1/calls/9876543/recording/download');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
