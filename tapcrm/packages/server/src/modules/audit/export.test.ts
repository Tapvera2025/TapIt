import { describe, expect, it } from 'vitest';
import { csvHeader, csvRow, AUDIT_EXPORT_COLUMNS, assertAuditExporter, type AuditExportInput } from './export.js';
import type { AuditEntryResource } from './repository.js';
import { AuthorizationError, configureAuthz } from '@tapcrm/authz';
import type { Action, PermissionSet } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';

const entry: AuditEntryResource = {
  type: 'auditEntry', id: 'entry-1', organizationId: '00000000-0000-0000-0000-000000000001',
  stream: 'activity', sequence: '4', occurredAt: new Date('2026-01-02T03:04:05.000Z'),
  actorId: '00000000-0000-0000-0000-000000000002', actorType: 'employee', action: 'employee.updated',
  targetType: 'user', targetId: '00000000-0000-0000-0000-000000000003', beforeData: { note: 'old, value' },
  afterData: { note: 'new "value"' }, reason: 'review', sourceIp: '127.0.0.1', requestId: 'request-1',
  hashVersion: 1, prevHash: null, hash: 'abcd', legalHold: false,
};

/** Authz ports whose only policy is `held` (a power the Super Admin gave to this person's position). */
function grantOnly(held: readonly Action[]): void {
  configureAuthz({
    scope: {
      subordinateIds: async () => new Set(),
      teamIds: async () => new Set(),
      poolIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
      teamMemberIds: async () => new Set(),
      departmentMemberIds: async () => new Set(),
      departmentId: async () => null,
    },
    policies: {
      resolveSet: async (): Promise<PermissionSet> => ({
        policies: Object.fromEntries(
          held.map((action) => [action, { action, allowed: true, scope: 'all-people', source: 'position' as const }]),
        ),
        cacheDeadline: new Date(Date.now() + 60_000),
        resolvedAt: new Date(),
      }),
    },
    audit: { sensitiveUse: () => undefined, superAdminBypass: () => undefined, segregationBlocked: () => undefined, defect: () => undefined },
    now: () => new Date(),
  });
}

function context(accountType: RequestContext['principal']['accountType']): RequestContext {
  return {
    organizationId: entry.organizationId,
    principal: {
      id: entry.actorId!, organizationId: entry.organizationId, accountType,
      sessionVersion: 1, allowedActions: [], allowedResources: [], expiresAt: new Date(Date.now() + 60_000),
    } as RequestContext['principal'],
    requestId: 'request-1', memo: new Map(), sourceIp: null,
  };
}

describe('audit export formatting and authorization', () => {
  it('emits stable CSV headers and escapes JSON and quotes', () => {
    expect(csvHeader()).toBe(`${AUDIT_EXPORT_COLUMNS.join(',')}\n`);
    const row = csvRow(entry);
    expect(row).toContain('""old, value""');
    expect(row).toContain('""note""');
    expect(row).toContain('new ');
    expect(row.endsWith('\n')).toBe(true);
  });

  it('rejects anyone without the export power before export work begins', async () => {
    grantOnly(['audit:view']);
    await expect(assertAuditExporter(context('employee'))).rejects.toThrow(AuthorizationError);
    await expect(assertAuditExporter(context('employee'))).rejects.toThrow(/only the Super Admin can grant/);
    await expect(assertAuditExporter(context('super-admin'))).resolves.toBeUndefined();
  });

  it('lets a position the Super Admin gave audit:export to export', async () => {
    grantOnly(['audit:view', 'audit:export']);
    await expect(assertAuditExporter(context('employee'))).resolves.toBeUndefined();
  });

  it('keeps export input limited to the existing audit filters', () => {
    const input: AuditExportInput = {
      format: 'json', stream: 'access', actorId: entry.actorId!, targetId: entry.targetId!,
      action: entry.action, from: new Date('2026-01-01T00:00:00.000Z'), to: entry.occurredAt,
    };
    expect(input.stream).toBe('access');
    expect(input.action).toBe('employee.updated');
  });
});
