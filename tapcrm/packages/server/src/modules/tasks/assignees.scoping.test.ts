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
  enqueueTaskAudit: vi.fn(),
}));

vi.mock('@tapcrm/authz', () => ({
  effectivePolicy: vi.fn(),
  visibilityFilter: vi.fn(),
}));

const mockDepartmentId = vi.fn<(_ctx: unknown) => Promise<string | null>>();
const mockTeamIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();
const mockPoolMemberIds = vi.fn<(_ctx: unknown) => Promise<ReadonlySet<string>>>();

vi.mock('../../platform/authz-adapter.js', () => ({
  scopeResolver: {
    departmentId: (_ctx: unknown): Promise<string | null> => mockDepartmentId(_ctx),
    teamIds: (_ctx: unknown): Promise<ReadonlySet<string>> => mockTeamIds(_ctx),
    poolIds: vi.fn(),
    subordinateIds: vi.fn(),
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

describe('listTaskAssignees Scope Resolution (Service Layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CASE 7: Super Admin accesses all active users across the organization', async () => {
    const ctx = makeContext({ accountType: 'super-admin' });
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([
      { id: 'user-1', fullName: 'User One', email: 'u1@example.com', departmentName: 'Dev', positionName: 'Dev' },
    ]);

    const result = await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'all' },
      {},
    );
    expect(result).toHaveLength(1);
  });

  it('CASE 1 & 5: Dev Dept Head with department scope resolves to creator departmentId', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('department'));
    mockDepartmentId.mockResolvedValueOnce('dept-development-id');
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, { search: 'Alice' });

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'department', departmentId: 'dept-development-id' },
      { search: 'Alice' },
    );
  });

  it('CASE 1 & 5: Sub-team Manager with team scope resolves to descendant teamIds', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('team'));
    mockTeamIds.mockResolvedValueOnce(
      new Set(['team-dev-1', 'team-dev-2']),
    );
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'team', teamIds: ['team-dev-1', 'team-dev-2'] },
      {},
    );
  });

  it('CASE 1 & 5: Sales Supervisor with pool scope resolves to pool member IDs', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('pool'));
    mockPoolMemberIds.mockResolvedValueOnce(
      new Set(['pool-member-1', 'pool-member-2']),
    );
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'pool', poolMemberIds: ['pool-member-1', 'pool-member-2'] },
      {},
    );
  });

  it('CASE 1 & 5: Project Manager with own scope resolves as Project Manager', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('own'));
    vi.mocked(repo.isPrincipalProjectManager).mockResolvedValueOnce(true);
    mockDepartmentId.mockResolvedValueOnce('00000000-0000-0000-0000-000000000020');
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, { projectId: '00000000-0000-0000-0000-000000000099' });

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'own', isProjectManager: true, departmentId: '00000000-0000-0000-0000-000000000020' },
      { projectId: '00000000-0000-0000-0000-000000000099' },
    );
  });

  it('CASE 1 & 5: Regular Developer / IC with own scope resolves departmentId for peer assignment', async () => {
    const ctx = makeContext();
    vi.mocked(authz.effectivePolicy).mockResolvedValueOnce(mockPolicy('own'));
    vi.mocked(repo.isPrincipalProjectManager).mockResolvedValueOnce(false);
    mockDepartmentId.mockResolvedValueOnce('00000000-0000-0000-0000-000000000020');
    vi.mocked(repo.findAssignableUsers).mockResolvedValueOnce([]);

    await listTaskAssignees(ctx, {});

    expect(repo.findAssignableUsers).toHaveBeenCalledWith(
      ctx,
      { kind: 'own', isProjectManager: false, departmentId: '00000000-0000-0000-0000-000000000020' },
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
