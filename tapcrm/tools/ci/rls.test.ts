import { describe, expect, it } from 'vitest';
import { inspectTenantRls } from './rls.js';

const nullableTable = `CREATE TABLE payment_webhook_event (
  id uuid PRIMARY KEY,
  organization_id uuid
);`;

describe('CI-33 — tenant table RLS declarations', () => {
  it('includes nullable organization_id columns in the guardrail', () => {
    expect(inspectTenantRls(nullableTable)).toEqual({
      tenantTables: ['payment_webhook_event'],
      unprotected: ['payment_webhook_event'],
    });
  });

  it('also includes required organization_id columns', () => {
    expect(
      inspectTenantRls(
        nullableTable.replace('organization_id uuid', 'organization_id uuid NOT NULL'),
      ).unprotected,
    ).toEqual(['payment_webhook_event']);
  });

  it('rejects ENABLE without FORCE', () => {
    const migrations = `${nullableTable}
ALTER TABLE payment_webhook_event ENABLE ROW LEVEL SECURITY;`;
    expect(inspectTenantRls(migrations).unprotected).toEqual(['payment_webhook_event']);
  });

  it('rejects FORCE without ENABLE', () => {
    const migrations = `${nullableTable}
ALTER TABLE payment_webhook_event FORCE ROW LEVEL SECURITY;`;
    expect(inspectTenantRls(migrations).unprotected).toEqual(['payment_webhook_event']);
  });

  it('accepts explicit ENABLE and FORCE together', () => {
    const migrations = `${nullableTable}
ALTER TABLE payment_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_event FORCE ROW LEVEL SECURITY;`;
    expect(inspectTenantRls(migrations).unprotected).toEqual([]);
  });

  it('accepts the helper that applies both flags', () => {
    const migrations = `${nullableTable}
SELECT apply_tenant_rls('payment_webhook_event');`;
    expect(inspectTenantRls(migrations).unprotected).toEqual([]);
  });

  it('does not treat the organization root as a tenant table', () => {
    expect(
      inspectTenantRls(nullableTable.replaceAll('payment_webhook_event', 'organization')),
    ).toEqual({ tenantTables: [], unprotected: [] });
  });
});
