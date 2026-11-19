import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Authz from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import type { CreatePenaltyBody } from './validators.js';

/**
 * Recording a penalty checks the employee being fined against the caller's
 * penalty:manage scope before anything is written. Database writes are
 * replaced by a sentinel transaction; the scope decision itself belongs to
 * the employeePenalty policy, which receives the employee's team and
 * department.
 */

const REACHED = new Error('reached the insert transaction');
const state = vi.hoisted(() => ({
  subjects: new Map<string, { id: string; departmentId: string | null; teamId: string | null }>(),
  allowedTeams: new Set<string>(),
  checked: [] as Array<{ action: string; resource: Record<string, unknown> }>,
}));

vi.mock('../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async () => { throw REACHED; }), maybeOne: vi.fn(), query: vi.fn() },
}));
vi.mock('./repository.js', () => ({
  findPenaltySubject: vi.fn(async (_ctx: unknown, id: string) => state.subjects.get(id) ?? null),
}));
vi.mock('@tapcrm/authz', async (original) => ({
  ...(await original<typeof Authz>()),
  authorize: vi.fn(async (_ctx: unknown, action: string, resource: Record<string, unknown>) => {
    state.checked.push({ action, resource });
    if (!state.allowedTeams.has(String(resource['teamId']))) throw new Error(`denied ${action}`);
  }),
}));

const { createPenalty } = await import('./service.js');

const manager = { organizationId: 'org-1', requestId: 'r', principal: { id: 'mgr' } } as unknown as RequestContext;

const body = (employeeId: string): CreatePenaltyBody => ({
  employeeId,
  penaltyType: 'late_arrival',
  amountPaise: 10000,
  penaltyDate: '2026-11-10',
  payrollPeriod: '2026-11-01',
  remarks: 'Late three times',
});

describe('recording a penalty', () => {
  beforeEach(() => {
    state.checked = [];
    state.subjects.clear();
    state.subjects.set('own-team-member', { id: 'own-team-member', departmentId: 'dept-a', teamId: 'team-a' });
    state.subjects.set('other-team-member', { id: 'other-team-member', departmentId: 'dept-a', teamId: 'team-b' });
    state.allowedTeams = new Set(['team-a']);
  });

  it('checks the employee being fined, with their team and department, against penalty:manage', async () => {
    await expect(createPenalty(manager, body('own-team-member'))).rejects.toBe(REACHED);
    expect(state.checked).toEqual([
      {
        action: 'penalty:manage',
        resource: expect.objectContaining({
          type: 'employeePenalty',
          organizationId: 'org-1',
          subjectId: 'own-team-member',
          departmentId: 'dept-a',
          teamId: 'team-a',
        }),
      },
    ]);
  });

  it('writes nothing when the employee is outside the caller\'s scope', async () => {
    await expect(createPenalty(manager, body('other-team-member'))).rejects.toThrow('denied penalty:manage');
  });

  it('refuses an unknown or inactive employee before checking anything else', async () => {
    await expect(createPenalty(manager, body('nobody'))).rejects.toThrow(/active employee/);
    expect(state.checked).toEqual([]);
  });
});
