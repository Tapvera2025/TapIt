import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
import type { PermissionPolicy, Principal, Scope } from '@tapcrm/contracts';
import { listTaskAssignees } from './service.js';
import * as repo from './repository.js';
import * as authz from '@tapcrm/authz';

vi.mock('./repository.js', () => ({
  findAssignableUsers: vi.fn(),
  isPrincipalProjectManager: vi.fn(),
  findTaskById: vi.fn(),
  findTaskByIdTx: vi.fn(),
  insertTaskAssignees: vi.fn(),
  insertTaskRow: vi.fn(),
  listTasksWithFilter: vi.fn(),
  replaceTaskAssignees: vi.fn(),
  updateTaskRow: vi.fn(),
  validateAssigneeIds: vi.fn(),
  findUsersInAssignableScope: vi.fn(),
  findLedTeamIds: vi.fn(),
  enqueueTaskAudit: vi.fn(),
}));

vi.mock('@tapcrm/authz', () => ({
  effectivePolicy: vi.fn(),
  visibilityFilter: vi.fn(),
}));

const mockDepartmentId = vi.fn<(_ctx: unknown) => Promise<string | null>>();
const mockTeamIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();
const mockPoolMemberIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();
const mockPoolIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();
const mockSubordinateIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();

vi.mock('../../platform/authz-adapter.js', () => ({
  scopeResolver: {
    departmentId: (_ctx: unknown): Promise<string | null> => mockDepartmentId(_ctx),
    teamIds: (_ctx: unknown): Promise<ReadonlySet<string>> => mockTeamIds(_ctx),
    poolIds: (_ctx: unknown): Promise<ReadonlySet<string>> => mockPoolIds(_ctx),
    subordinateIds: (_ctx: unknown): Promise<ReadonlySet<string>> => mockSubordinateIds(_ctx),
    poolMemberIds: (_ctx: unknown): Promise<ReadonlySet<string>> => mockPoolMemberIds(_ctx),
  },
}));

function mockPolicy(scope: Scope): PermissionPolicy {
  return {
    action: 'tasks:assign',
    allowed: true,
    scope,
    source: 'position',
  };
}

function makeContext(principalOverrides: Partial<Principal> = {}): RequestContext {
  const orgId = '00000000-0000-0000-0000-000000000001';
  return {
    organizationId: orgId,
    requestId: 'req-test',
    sourceIp: '127.0.0.1',
    memo: new Map(),
    principal: {
      id: '00000000-0000-0000-0000-000000000002',
      organizationId: orgId,
      accountType: 'employee',
      sessionVersion: 1,
      positionId: '00000000-0000-0000-0000-000000000010',
      departmentId: '00000000-0000-0000-0000-000000000020',
      teamId: '00000000-0000-0000-0000-000000000030',
      reportsTo: null,
      organizationalLevel: 25,
      ...principalOverrides,
    } as Principal,
  };
}

const SELF = '00000000-0000-0000-0000-000000000002';
const REPORT = '00000000-0000-0000-0000-000000000077';

describe('listTaskAssignees Scope Resolution (Service Layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The subordinate CTE includes the principal (VIS-1).
    mockSubordinateIds.mockResolvedValue(new Set([SELF, REPORT]));
    vi.mocked(repo.findLedTeamIds).mockResolvedValue([]);
  });

  it('CASE 7: Super Admin accesses all active users across the organization', async () => {
    const ctx = makeContext({ accountType: 'super-admin' });
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([
      { id: 'user-1', fullName: 'User One', email: 'u1@example.com', departmentName: 'Dev', positionName: 'Dev' },
    ]);

    const result = await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(ctx, { kind: 'all' }, {});
    expect(result).toHaveLength(1);
  });

  it('CASE 1 & 5: Dev Dept Head with department scope: department plus reports', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('department'));
    mockDepartmentId.mockResolvedValueOnce('dept-development-id');
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, { search: 'Alice' });

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'scoped', userIds: [SELF, REPORT], departmentId: 'dept-development-id' },
      { search: 'Alice' },
    );
  });

  it('CASE 1 & 5: Sub-team Manager with team scope: team tree, led teams and reports', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('team'));
    mockTeamIds.mockResolvedValueOnce(new Set(['team-dev-1', 'team-dev-2']));
    vi.mocked(repo.findLedTeamIds).mockResolvedValueOnce(['team-led-1']);
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'scoped', userIds: [SELF, REPORT], teamIds: ['team-dev-1', 'team-dev-2', 'team-led-1'] },
      {},
    );
  });

  it('CASE 1 & 5: Sales Supervisor with pool scope: pool members, pool and reports', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('pool'));
    mockPoolMemberIds.mockResolvedValueOnce(new Set(['pool-member-1', 'pool-member-2']));
    mockPoolIds.mockResolvedValueOnce(new Set(['pool-1']));
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'scoped', userIds: [SELF, REPORT, 'pool-member-1', 'pool-member-2'], teamIds: ['pool-1'] },
      {},
    );
  });

  it('CASE 1 & 5: Project Manager with own scope directs the development department', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('own'));
    vi.mocked(repo.isPrincipalProjectManager).mockResolvedValueOnce(true);
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, { projectId: '00000000-0000-0000-0000-000000000099' });

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'scoped', userIds: [SELF, REPORT], departmentCode: 'development' },
      { projectId: '00000000-0000-0000-0000-000000000099' },
    );
  });

  it('CASE 1 & 5: Regular Developer / IC with own scope: only themselves and their reports', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('own'));
    vi.mocked(repo.isPrincipalProjectManager).mockResolvedValueOnce(false);
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'scoped', userIds: [SELF, REPORT] },
      {},
    );
  });

  it('CASE 2: Denied / missing policy returns empty array', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(null);

    const result = await listTaskAssignees(ctx, {});

    expect(result).toEqual([]);
    expect(repo.findAssignableUsers).not.toHaveBeenCalled();
  });
});
