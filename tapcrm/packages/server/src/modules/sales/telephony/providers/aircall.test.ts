import { describe, expect, it } from 'vitest';
import type { NormalizedCall } from '../types.js';
import { AircallClient, normalizeAircallCall, normalizeAircallUser } from './aircall.js';

const STARTED = 1793365200; // 2026-10-30T13:00:00Z

/** An Aircall Public API call object (developer.aircall.io, "Call"). */
const CALL = {
  id: 812,
  sid: 'CA6d3b7b0c',
  direct_link: 'https://api.aircall.io/v1/calls/812',
  direction: 'inbound',
  status: 'done',
  missed_call_reason: null,
  started_at: STARTED,
  answered_at: STARTED + 12,
  ended_at: STARTED + 192,
  duration: 192,
  raw_digits: '+33 6 12 34 56 78',
  recording: 'https://aircall-recordings.s3.amazonaws.com/812.mp3?X-Amz-Signature=abc',
  asset: 'https://assets.aircall.io/calls/812/recording',
  voicemail: null,
  archived: false,
  cost: '0.0',
  number: { id: 33, name: 'Paris office', digits: '+33 1 76 36 06 95', country: 'FR', time_zone: 'Europe/Paris' },
  user: { id: 456, name: 'Asha Rao', email: 'Asha.Rao@Tapvera.com' },
  contact: { id: 77, first_name: 'Rahul', last_name: 'Shah', emails: [{ label: 'work', value: 'rahul@example.com' }] },
  assigned_to: null,
  transferred_by: null,
  transferred_to: null,
  teams: [{ id: 3, name: 'Support' }],
  comments: [{ id: 1, content: 'Asked for invoice copy', posted_at: STARTED + 300 }],
  tags: [{ id: 9, name: 'Billing' }],
};

const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Aircall call normalization', () => {
  it('maps a documented call onto the CRM call', () => {
    const call = normalizeAircallCall(CALL)!;
    expect(call).toMatchObject({
      externalId: '812',
      direction: 'inbound',
      outcome: 'answered',
      providerStatus: 'done',
      durationSeconds: 192,
      talkSeconds: 180,
      ringSeconds: 12,
      contactNumber: '+33612345678',
      contactName: 'Rahul Shah',
      contactEmail: 'rahul@example.com',
      businessNumber: '+33176360695',
      businessNumberName: 'Paris office',
      hasRecording: true,
      hasVoicemail: false,
      notes: 'Asked for invoice copy',
      tags: ['Billing'],
    });
    expect(call.agent).toEqual({ externalId: '456', name: 'Asha Rao', email: 'asha.rao@tapvera.com' });
    expect(call.startedAt.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(call.answeredAt?.toISOString()).toBe('2026-10-30T13:00:12.000Z');
    expect(call.metadata).toMatchObject({ sid: 'CA6d3b7b0c', teams: ['Support'], country: 'FR' });
  });

  it('separates missed, abandoned, voicemail and unanswered calls', () => {
    const unanswered = { ...CALL, answered_at: null, recording: null, asset: null };
    expect(normalizeAircallCall({ ...unanswered, missed_call_reason: 'agents_did_not_answer' })!.outcome).toBe('missed');
    expect(normalizeAircallCall({ ...unanswered, missed_call_reason: 'short_abandoned' })!.outcome).toBe('abandoned');
    expect(normalizeAircallCall({ ...unanswered, missed_call_reason: 'abandoned_in_ivr' })!.outcome).toBe('abandoned');
    const voicemail = normalizeAircallCall({ ...unanswered, voicemail: 'https://aircall-voicemails.s3.amazonaws.com/v.mp3' })!;
    expect(voicemail.outcome).toBe('voicemail');
    expect(voicemail.hasVoicemail).toBe(true);
    expect(voicemail.talkSeconds).toBe(0);
    expect(normalizeAircallCall({ ...unanswered, direction: 'outbound' })!.outcome).toBe('unanswered');
  });

  it('attributes an unowned call to the user it was assigned to', () => {
    const call = normalizeAircallCall({ ...CALL, user: null, assigned_to: { id: 999, name: 'Queue Owner', email: 'owner@x.io' } })!;
    expect(call.agent?.externalId).toBe('999');
  });

  it('maps V1 and V2 user shapes', () => {
    expect(normalizeAircallUser({ id: 456, name: 'Asha Rao', email: 'ASHA@x.io', time_zone: 'Europe/Paris', numbers: [{ digits: '+33 1 76 36 06 95' }] })).toMatchObject({
      externalId: '456',
      name: 'Asha Rao',
      email: 'asha@x.io',
      timeZone: 'Europe/Paris',
      phoneNumbers: ['+33176360695'],
    });
    expect(normalizeAircallUser({ id: 7, first_name: 'Dev', last_name: 'Patel', email: 'dev@x.io' })?.name).toBe('Dev Patel');
  });
});

describe('Aircall client', () => {
  const credentials = { provider: 'aircall' as const, apiId: 'id-1234567890', apiToken: 'token-abcdefgh' };

  it('authenticates with HTTP Basic and pings', async () => {
    let auth: string | null = null;
    let path = '';
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      path = new URL(urlOf(input)).pathname;
      return json({ ping: 'pong' });
    }) as typeof fetch;
    await new AircallClient(credentials, { fetchImpl }).verify();
    expect(path).toBe('/v1/ping');
    expect(auth).toBe(`Basic ${Buffer.from('id-1234567890:token-abcdefgh').toString('base64')}`);
  });

  it('reads users from V2, falling back to V1 for accounts still on it', async () => {
    const paths: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(urlOf(input));
      paths.push(url.pathname);
      if (url.pathname === '/v2/users') return json({ message: 'Not Found' }, 404);
      return json({ users: [{ id: 1, name: 'A', email: 'a@x.io' }], meta: { next_page_link: null } });
    }) as typeof fetch;
    const agents = await new AircallClient(credentials, { fetchImpl }).listAgents();
    expect(paths).toEqual(['/v2/users', '/v1/users']);
    expect(agents.map((agent) => agent.externalId)).toEqual(['1']);
  });

  it('pages calls with meta.next_page_link and UNIX-second windows', async () => {
    const seen: URL[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(urlOf(input));
      seen.push(url);
      if (url.searchParams.get('page') === '2') return json({ calls: [{ ...CALL, id: 2 }], meta: { next_page_link: null } });
      return json({
        calls: [{ ...CALL, id: 1 }],
        meta: { next_page_link: 'https://api.aircall.io/v1/calls?page=2&per_page=50' },
      });
    }) as typeof fetch;
    const pages: NormalizedCall[][] = [];
    await new AircallClient(credentials, { fetchImpl }).listCalls(
      { from: new Date(STARTED * 1000), to: new Date((STARTED + 3600) * 1000) },
      async (calls) => {
        pages.push([...calls]);
      },
    );
    expect(pages.map((page) => page.map((call) => call.externalId))).toEqual([['1'], ['2']]);
    expect(seen[0]!.searchParams.get('from')).toBe(String(STARTED));
    expect(seen[0]!.searchParams.get('to')).toBe(String(STARTED + 3600));
    expect(seen[0]!.searchParams.get('order')).toBe('asc');
    expect(seen[0]!.searchParams.get('per_page')).toBe('50');
  });

  it('fetches a fresh recording link and downloads it without the API credentials', async () => {
    const requests: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      requests.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url.startsWith('https://api.aircall.io/v1/calls/812')) return json({ call: CALL });
      return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    const response = await new AircallClient(credentials, { fetchImpl }).fetchRecording('812');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(requests[1]!.url).toBe(CALL.recording);
    expect(requests[1]!.auth).toBeNull();
  });

  it('refuses a recording link outside the platform storage hosts', async () => {
    const fetchImpl = (async () => json({ call: { ...CALL, recording: 'https://attacker.example.com/r.mp3' } })) as typeof fetch;
    await expect(new AircallClient(credentials, { fetchImpl }).fetchRecording('812')).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
