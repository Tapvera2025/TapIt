import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  // The config loader wants a whole environment; nothing here connects to it.
  process.env['DATABASE_URL'] ??= 'postgres://x:y@127.0.0.1:1/z';
  process.env['REDIS_URL'] ??= 'redis://127.0.0.1:59999';
  process.env['JWT_ACCESS_SECRET'] ??= 'a'.repeat(40);
  process.env['JWT_REFRESH_SECRET'] ??= 'b'.repeat(40);
  process.env['MEETINGS_TOKEN_ENCRYPTION_KEY'] ??= '5f2b8c0e9d4a7b1c3e6f8a0b2d4c6e8f1a3b5c7d9e0f2a4b6c8d0e2f4a6b8c0d';
  (await import('../../../config.js')).__resetConfig();
});

const { CalendarAuthError, addGuest, deleteEvent, freeBusy, insertEvent, moveEvent } = await import('./calendar.js');
const { openSecret, sealSecret } = await import('./crypto.js');

interface Call { url: string; method: string; body: unknown }

function stubFetch(responses: Array<{ status?: number; body?: unknown }>): Call[] {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Google Calendar client', () => {
  it('reads busy times from the primary calendar', async () => {
    const calls = stubFetch([{ body: { calendars: { primary: { busy: [{ start: '2026-11-12T05:30:00Z', end: '2026-11-12T06:30:00Z' }] } } } }]);
    const busy = await freeBusy('token', new Date('2026-11-12T00:00:00Z'), new Date('2026-11-13T00:00:00Z'));
    expect(busy).toEqual([{ start: new Date('2026-11-12T05:30:00Z'), end: new Date('2026-11-12T06:30:00Z') }]);
    expect(calls[0]!.url).toMatch(/\/calendar\/v3\/freeBusy$/);
    expect(calls[0]!.body).toMatchObject({ items: [{ id: 'primary' }] });
  });

  it('creates the event with a new Meet conference and has Google invite the guests', async () => {
    const calls = stubFetch([{ body: { id: 'evt1', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } } }]);
    const event = await insertEvent('token', {
      summary: 'Storefront review',
      description: 'Agenda',
      start: new Date('2026-11-12T09:30:00Z'),
      end: new Date('2026-11-12T10:00:00Z'),
      timeZone: 'Asia/Kolkata',
      guests: [{ email: 'riya@example.com', name: 'Riya' }],
      requestId: 'req-1',
    });
    expect(event).toEqual({ eventId: 'evt1', meetUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(calls[0]!.url).toContain('conferenceDataVersion=1');
    expect(calls[0]!.url).toContain('sendUpdates=all');
    expect(calls[0]!.body).toMatchObject({
      attendees: [{ email: 'riya@example.com', displayName: 'Riya' }],
      conferenceData: { createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
  });

  it('reads the event back while Google is still making the conference', async () => {
    const calls = stubFetch([
      { body: { id: 'evt2', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } } },
      { body: { id: 'evt2', hangoutLink: 'https://meet.google.com/xyz-abcd-efg' } },
    ]);
    const event = await insertEvent('token', {
      summary: 's', description: 'd', start: new Date(), end: new Date(Date.now() + 1_800_000), timeZone: 'UTC', guests: [], requestId: 'req-2',
    });
    expect(event.meetUrl).toBe('https://meet.google.com/xyz-abcd-efg');
    expect(calls[1]!.method).toBe('GET');
  });

  it('moves the event and tells the guests; adds a guest quietly; cancels for everyone', async () => {
    const calls = stubFetch([
      { body: {} },
      { body: { id: 'evt3', attendees: [{ email: 'riya@example.com' }] } },
      { body: {} },
      { status: 204 },
    ]);
    await moveEvent('token', 'evt3', new Date('2026-11-12T11:00:00Z'), new Date('2026-11-12T11:30:00Z'), 'Asia/Kolkata');
    await addGuest('token', 'evt3', { email: 'admin@example.com', name: 'Admin' });
    await deleteEvent('token', 'evt3');
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { start: { dateTime: '2026-11-12T11:00:00.000Z' } } });
    expect(calls[0]!.url).toContain('sendUpdates=all');
    expect(calls[2]!.url).toContain('sendUpdates=none');
    expect(calls[2]!.body).toEqual({ attendees: [{ email: 'riya@example.com' }, { email: 'admin@example.com', displayName: 'Admin' }] });
    expect(calls[3]).toMatchObject({ method: 'DELETE' });
    expect(calls[3]!.url).toContain('sendUpdates=all');
  });

  it('treats an event already deleted in Google as cancelled', async () => {
    stubFetch([{ status: 410, body: { error: { message: 'Resource has been deleted' } } }]);
    await expect(deleteEvent('token', 'gone')).resolves.toBeUndefined();
  });

  it('reports a refused token so the person can reconnect', async () => {
    stubFetch([{ status: 401, body: { error: { message: 'Invalid Credentials' } } }]);
    await expect(freeBusy('bad', new Date(), new Date())).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe('stored calendar tokens', () => {
  it('open only for the person they were sealed for', () => {
    const sealed = sealSecret('refresh-token', 'org-1', 'user-1');
    expect(sealed).not.toContain('refresh-token');
    expect(openSecret(sealed, 'org-1', 'user-1')).toBe('refresh-token');
    expect(() => openSecret(sealed, 'org-1', 'user-2')).toThrow();
  });
});
