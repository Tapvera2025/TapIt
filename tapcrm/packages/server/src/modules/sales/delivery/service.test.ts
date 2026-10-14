import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectivePolicy } from '@tapcrm/authz';
import type { PermissionPolicy, Principal } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import * as repository from './repository.js';
import { reviewDecision } from './service.js';
import type { DeliveryBrief } from './types.js';

vi.mock('@tapcrm/authz', () => ({ effectivePolicy: vi.fn() }));
vi.mock('./repository.js');
vi.mock('../../../platform/dal/db.js', () => ({
  db: {
    transaction: vi.fn(async (_ctx: RequestContext, work: (tx: Tx) => Promise<unknown>) =>
      work({} as Tx)),
  },
}));

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const BRIEF_ID = '00000000-0000-4000-8000-000000000003';
const DEAL_ID = '00000000-0000-4000-8000-000000000004';
const COMMERCIALS_ID = '00000000-0000-4000-8000-000000000005';
const TIMESTAMP = new Date('2026-10-12T00:00:00.000Z');
const REASON = 'Customer withdrew';
const CANCEL = { decision: 'cancel', reason: REASON } as const;

function context(as: 'employee' | 'super-admin' = 'employee'): RequestContext {
  const identity = {
    id: USER_ID,
    organizationId: ORGANIZATION_ID,
    sessionVersion: 1,
  };
  // Build the principal shape the test calls for. CI-19 forbids
  // `accountType === 'super-admin'` outside the authorization engine, so the
  // test fixture branches on its own parameter instead.
  const principal: Principal = as === 'employee'
    ? {
        ...identity,
        accountType: 'employee',
        positionId: '00000000-0000-4000-8000-000000000006',
        departmentId: '00000000-0000-4000-8000-000000000007',
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      }
    : { ...identity, accountType: 'super-admin' };
  return {
    organizationId: ORGANIZATION_ID,
    principal,
    requestId: 'delivery-cancel-test',
    sourceIp: null,
    memo: new Map(),
  };
}

function approvalPolicy(allowed: boolean): PermissionPolicy {
  return { action: 'deals:approve', allowed, scope: 'department', source: 'position' };
}

const cancelledBrief: DeliveryBrief = {
  id: BRIEF_ID,
  organizationId: ORGANIZATION_ID,
  dealId: DEAL_ID,
  commercialsId: COMMERCIALS_ID,
  state: 'cancelled',
  content: {},
  projectId: null,
  submittedAt: TIMESTAMP,
  reviewedAt: null,
  reviewedBy: null,
  acceptedAt: null,
  acceptedBy: null,
  cancelledAt: TIMESTAMP,
  cancelledReason: REASON,
  changeNotes: null,
  createdBy: USER_ID,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

describe('delivery brief cancellation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(effectivePolicy).mockResolvedValue(null);
    vi.mocked(repository.lockBrief).mockResolvedValue({
      id: BRIEF_ID,
      dealId: DEAL_ID,
      commercialsId: COMMERCIALS_ID,
      state: 'submitted',
      projectId: null,
      acceptedAt: null,
      updatedAt: TIMESTAMP,
    });
    vi.mocked(repository.loadDealContext).mockResolvedValue({
      id: DEAL_ID,
      lifecycleStatus: 'won',
      commercialsId: COMMERCIALS_ID,
    });
    vi.mocked(repository.findBrief).mockResolvedValue(cancelledBrief);
  });

  it.each([
    ['missing', null],
    ['denied', approvalPolicy(false)],
  ] as const)('rejects an employee with a %s deal approval policy after Win', async (_label, policy) => {
    const ctx = context();
    vi.mocked(effectivePolicy).mockResolvedValue(policy);

    await expect(reviewDecision(ctx, BRIEF_ID, CANCEL)).rejects.toBeInstanceOf(PlatformForbiddenError);

    expect(effectivePolicy).toHaveBeenCalledWith(ctx, 'deals:approve');
    expect(repository.markCancelled).not.toHaveBeenCalled();
    expect(repository.insertBriefAudit).not.toHaveBeenCalled();
    expect(repository.findBrief).not.toHaveBeenCalled();
  });

  it('allows an employee with a granted deal approval policy to cancel after Win', async () => {
    const ctx = context();
    vi.mocked(effectivePolicy).mockResolvedValue(approvalPolicy(true));

    await expect(reviewDecision(ctx, BRIEF_ID, CANCEL)).resolves.toEqual(cancelledBrief);

    expect(effectivePolicy).toHaveBeenCalledWith(ctx, 'deals:approve');
    expect(repository.markCancelled).toHaveBeenCalledWith(
      expect.anything(), ORGANIZATION_ID, BRIEF_ID, USER_ID, REASON, expect.any(Date),
    );
    expect(repository.insertBriefAudit).toHaveBeenCalledWith(
      expect.anything(), ctx, 'delivery.brief_cancelled', BRIEF_ID,
      { state: 'submitted' },
      { state: 'cancelled', reason: REASON, dealLifecycle: 'won' },
    );
  });

  it('allows Super Admin to cancel after Win without resolving a position policy', async () => {
    await expect(reviewDecision(context('super-admin'), BRIEF_ID, CANCEL)).resolves.toEqual(cancelledBrief);

    expect(effectivePolicy).not.toHaveBeenCalled();
    expect(repository.markCancelled).toHaveBeenCalledOnce();
    expect(repository.insertBriefAudit).toHaveBeenCalledOnce();
  });

  it.each(['open', 'lost', 'cancelled'])('does not require deal approval when the deal is %s', async (lifecycleStatus) => {
    vi.mocked(repository.loadDealContext).mockResolvedValue({
      id: DEAL_ID,
      lifecycleStatus,
      commercialsId: COMMERCIALS_ID,
    });

    await expect(reviewDecision(context(), BRIEF_ID, CANCEL)).resolves.toEqual(cancelledBrief);

    expect(effectivePolicy).not.toHaveBeenCalled();
    expect(repository.markCancelled).toHaveBeenCalledOnce();
    expect(repository.insertBriefAudit).toHaveBeenCalledOnce();
  });
});
