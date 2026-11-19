import { describe, expect, it, vi } from 'vitest';
import type * as Authz from '@tapcrm/authz';
import type { RequestContext } from '../dal/context.js';

// A stand-in for the engine's projection: a position whose field allowlist is
// id, name and stage. Anything else is omitted, as AZ-I3 requires.
const ALLOWED = new Set(['id', 'name', 'stage']);
vi.mock('@tapcrm/authz', async (original) => ({
  ...(await original<typeof Authz>()),
  project: vi.fn(async (_ctx: unknown, _action: unknown, record: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => ALLOWED.has(key))),
  ),
}));

const { projectResult } = await import('./router.js');
const ctx = {} as RequestContext;
const deal = (id: string) => ({ id, name: `Deal ${id}`, stage: 'proposal', value: 500000, margin: 0.4 });

describe('response projection', () => {
  it('projects each record of a list page and keeps the page\'s own keys', async () => {
    const page = { items: [deal('1'), deal('2')], total: 2, nextCursor: 'abc' };
    expect(await projectResult(ctx, 'deals:view', page)).toEqual({
      items: [
        { id: '1', name: 'Deal 1', stage: 'proposal' },
        { id: '2', name: 'Deal 2', stage: 'proposal' },
      ],
      total: 2,
      nextCursor: 'abc',
    });
  });

  it('keeps an empty page a page (it used to come back as {})', async () => {
    expect(await projectResult(ctx, 'deals:view', { items: [], total: 0 })).toEqual({ items: [], total: 0 });
  });

  it('still projects a single record, nested arrays included as they were', async () => {
    expect(await projectResult(ctx, 'deals:view', { ...deal('9'), contacts: [{ id: 'c' }] })).toEqual({
      id: '9', name: 'Deal 9', stage: 'proposal',
    });
  });

  it('projects a record nested in a response without an id', async () => {
    expect(await projectResult(ctx, 'deals:view', { row: deal('3'), allowedMoves: ['in', 'out'] })).toEqual({
      row: { id: '3', name: 'Deal 3', stage: 'proposal' },
      allowedMoves: ['in', 'out'],
    });
  });

  it('never returns internal page keys', async () => {
    expect(await projectResult(ctx, 'deals:view', { items: [], __debug: 1 })).toEqual({ items: [] });
  });

  it('projects plain arrays element by element', async () => {
    expect(await projectResult(ctx, 'deals:view', [deal('4'), 'x'])).toEqual([
      { id: '4', name: 'Deal 4', stage: 'proposal' },
      'x',
    ]);
  });
});
