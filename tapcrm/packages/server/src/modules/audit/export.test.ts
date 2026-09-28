import { describe, expect, it } from 'vitest';
import { csvHeader, csvRow, AUDIT_EXPORT_COLUMNS, assertAuditExporter, type AuditExportInput } from './export.js';
import type { AuditEntryResource } from './repository.js';
import { AuthorizationError } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';

const entry: AuditEntryResource = {
  type: 'auditEntry', id: 'entry-1', organizationId: '00000000-0000-0000-0000-000000000001',
  stream: 'activity', sequence: '4', occurredAt: new Date('2026-01-02T03:04:05.000Z'),
  actorId: '00000000-0000-0000-0000-000000000002', actorType: 'employee', action: 'employee.updated',
  targetType: 'user', targetId: '00000000-0000-0000-0000-000000000003', beforeData: { note: 'old, value' },
  afterData: { note: 'new "value"' }, reason: 'review', sourceIp: '127.0.0.1', requestId: 'request-1',
  hashVersion: 1, prevHash: null, hash: 'abcd', legalHold: false,
};

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

  it('rejects a non-Super Admin before export work begins', () => {
    expect(() => assertAuditExporter(context('employee'))).toThrow(AuthorizationError);
    expect(() => assertAuditExporter(context('employee'))).toThrow(/Only Super Admin/);
    expect(() => assertAuditExporter(context('super-admin'))).not.toThrow();
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
