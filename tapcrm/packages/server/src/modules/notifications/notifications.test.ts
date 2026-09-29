import { describe, expect, it, vi } from 'vitest';
import { notify } from './facade.js';
import { decodeCursor, encodeCursor } from './repository.js';
import { outboxPayloadSchema } from './types.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const ctx = { organizationId: ORG, principal: { id: ACTOR } } as never;

const valid = {
  type: 'lead.assigned',
  title: 'New lead',
  audience: { users: [USER] },
  actorId: null,
};

describe('outbox payload schema', () => {
  it('applies defaults', () => {
    const parsed = outboxPayloadSchema.parse(valid);
    expect(parsed).toMatchObject({ priority: 'informational', body: '', link: null, metadata: {}, expiresInDays: 90 });
  });

  it('rejects an empty audience', () => {
    expect(() => outboxPayloadSchema.parse({ ...valid, audience: {} })).toThrow(/audience is empty/);
    expect(() => outboxPayloadSchema.parse({ ...valid, audience: { users: [] } })).toThrow(/audience is empty/);
  });

  it('rejects an action that is not in the registry', () => {
    expect(() => outboxPayloadSchema.parse({ ...valid, audience: { holders: { action: 'nope:nothing' } } })).toThrow(/unknown registry action/);
    expect(outboxPayloadSchema.parse({ ...valid, audience: { holders: { action: 'audit:view' } } })).toBeTruthy();
  });

  it.each(['https://evil.example/login', '//evil.example', 'javascript:alert(1)', 'leads/1'])(
    'rejects a non in-app link: %s',
    (link) => {
      expect(() => outboxPayloadSchema.parse({ ...valid, link })).toThrow(/in-app path/);
    },
  );

  it('accepts an in-app link and rejects malformed ids and types', () => {
    expect(outboxPayloadSchema.parse({ ...valid, link: '/leads/42' }).link).toBe('/leads/42');
    expect(() => outboxPayloadSchema.parse({ ...valid, audience: { users: ['not-a-uuid'] } })).toThrow();
    expect(() => outboxPayloadSchema.parse({ ...valid, type: 'bad type!' })).toThrow();
  });
});

describe('notify() facade', () => {
  it('writes exactly one outbox row inside the caller transaction and does nothing else', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await notify({ query } as never, ctx, {
      type: 'lead.assigned',
      priority: 'operational',
      audience: { users: [USER] },
      title: 'New lead',
      link: '/leads/1',
      metadata: { leadId: 'abc' },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const fragment = query.mock.calls[0]![0] as { sql: string; parameters: unknown[] };
    expect(fragment.sql).toContain('INSERT INTO notification_outbox');
    expect(fragment.parameters[0]).toBe(ORG);
    const payload = JSON.parse(fragment.parameters[1] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({ type: 'lead.assigned', priority: 'operational', actorId: ACTOR, link: '/leads/1' });
  });

  it('throws on a malformed call so the developer error surfaces in tests, not production', async () => {
    const query = vi.fn();
    await expect(notify({ query } as never, ctx, { type: 'x', title: 't', audience: {} })).rejects.toThrow(/audience is empty/);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('cursor', () => {
  it('round-trips and rejects garbage', () => {
    const at = '2026-09-25T10:00:00.000Z';
    const decoded = decodeCursor(encodeCursor({ createdAt: at, id: USER }));
    expect(decoded?.createdAt.toISOString()).toBe(at);
    expect(decoded?.id).toBe(USER);
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(Buffer.from('[1]').toString('base64url'))).toBeNull();
  });
});
