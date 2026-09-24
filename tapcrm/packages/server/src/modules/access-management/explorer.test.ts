import { describe, expect, it } from 'vitest';
import type { Action, PermissionPolicy } from '@tapcrm/contracts';
import { ACTIONS } from '@tapcrm/contracts';
import { buildEffectiveAccessRows } from './service.js';
import type { ActiveOverrideRecord } from './repository.js';

const resolvedOverridePolicy: PermissionPolicy = {
  action: 'payroll:view',
  allowed: true,
  scope: 'own',
  fields: ['employeeId'],
  source: 'override',
};

const override: ActiveOverrideRecord = {
  id: 'override-1',
  action: 'payroll:view',
  allowed: true,
  scope: 'own',
  fields: ['employeeId'],
  constraints: null,
  reason: 'Temporary payroll review',
  grantedBy: 'admin-1',
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-02-01T00:00:00.000Z'),
};

describe('AM-4 effective access projection', () => {
  it('returns every registry action and preserves override provenance', () => {
    const rows = buildEffectiveAccessRows(
      false,
      new Map<Action, PermissionPolicy>([['payroll:view', resolvedOverridePolicy]]),
      [override],
    );
    const payroll = rows.find((row) => row.action === 'payroll:view');
    expect(rows).toHaveLength(ACTIONS.length);
    expect(payroll).toMatchObject({
      allowed: true,
      scope: 'own',
      source: 'override',
      override: { id: 'override-1', reason: 'Temporary payroll review' },
    });
  });

  it('represents derived global access for every action without a stored scope', () => {
    const rows = buildEffectiveAccessRows(true, new Map(), []);
    expect(rows.every((row) => row.allowed && row.source === 'super-admin')).toBe(true);
    expect(rows.every((row) => row.scope === null)).toBe(true);
  });
});
