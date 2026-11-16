import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';

/** Accepting a delivery brief links exactly one usable project to it. */

interface State {
  brief: { id: string; state: string; projectId: string | null };
  project: { id: string; archived: boolean } | null;
  linkedElsewhere: { id: string; dealId: string } | null;
  accepted: string[];
}
const state = vi.hoisted((): State => ({
  brief: { id: 'brief-1', state: 'submitted', projectId: null },
  project: { id: 'project-1', archived: false },
  linkedElsewhere: null,
  accepted: [],
}));

vi.mock('../../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async (_ctx: unknown, work: (t: unknown) => Promise<unknown>) => work({})) },
}));
vi.mock('./repository.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  lockBrief: vi.fn(async () => state.brief),
  checkProjectExists: vi.fn(async () => state.project),
  findBriefLinkedToProject: vi.fn(async () => state.linkedElsewhere),
  markAccepted: vi.fn(async (_tx: unknown, _org: string, briefId: string, _by: string, projectId: string) => {
    state.accepted.push(`${briefId}->${projectId}`);
  }),
  insertBriefAudit: vi.fn(async () => undefined),
  findBrief: vi.fn(async () => ({ id: 'brief-1', state: 'accepted', projectId: 'project-1' })),
}));

const { reviewDecision } = await import('./service.js');
const pm = { organizationId: 'org-1', requestId: 'r', principal: { id: 'pm', accountType: 'employee' } } as unknown as RequestContext;
const accept = { decision: 'accept', projectId: 'project-1' } as never;

describe('accepting a delivery brief', () => {
  beforeEach(() => {
    state.brief = { id: 'brief-1', state: 'submitted', projectId: null };
    state.project = { id: 'project-1', archived: false };
    state.linkedElsewhere = null;
    state.accepted = [];
  });

  it('links a free, active project', async () => {
    await reviewDecision(pm, 'brief-1', accept);
    expect(state.accepted).toEqual(['brief-1->project-1']);
  });

  it('refuses a project already delivering another deal', async () => {
    state.linkedElsewhere = { id: 'brief-0', dealId: 'deal-0' };
    await expect(reviewDecision(pm, 'brief-1', accept)).rejects.toMatchObject({ status: 409, code: 'PROJECT_ALREADY_LINKED' });
    expect(state.accepted).toEqual([]);
  });

  it('refuses an archived project', async () => {
    state.project = { id: 'project-1', archived: true };
    await expect(reviewDecision(pm, 'brief-1', accept)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
  });

  it('refuses an unknown project', async () => {
    state.project = null;
    await expect(reviewDecision(pm, 'brief-1', accept)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});
