import { describe, expect, it } from 'vitest';
import type { SqlFragment } from '@tapcrm/authz';
import type { Tx } from '../dal/db.js';
import { ORGANIZATION_TEMPLATE } from './template.js';
import {
  provisionDefaultPositionPolicies,
  type RegistryActionDefinition,
} from './policy-matrix.js';

const position = ORGANIZATION_TEMPLATE.positions.find(
  (item) => item.code === 'dev-dept-head',
)!;
const hrPosition = ORGANIZATION_TEMPLATE.positions.find((item) => item.code === 'hr')!;

const registry: RegistryActionDefinition[] = [
  {
    action: 'org:view-structure',
    module: 'organization',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'org:view-people',
    module: 'organization',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'org:view-designations',
    module: 'organization',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'org:view-policies',
    module: 'organization',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'projects:view',
    module: 'projects',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'access:request-role-change',
    module: 'access-management',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'access:view',
    module: 'access-management',
    positionGrantable: true,
    superAdminOnly: false,
  },
  {
    action: 'users:manage',
    module: 'employee-directory',
    positionGrantable: true,
    superAdminOnly: false,
  },
];

function fakeTx(
  initial: Array<{
    organizationId: string;
    positionId: string;
    action: string;
    scope: string;
  }> = [],
) {
  const rows = new Map(
    initial.map((row) => [`${row.organizationId}:${row.positionId}:${row.action}`, row]),
  );
  const tx: Tx = {
    async query<T>(fragment: SqlFragment): Promise<T[]> {
      if (fragment.sql.includes('FROM registry_action')) return registry as T[];
      if (fragment.sql.includes('INSERT INTO position_policy')) {
        const [organizationId, positionId, action, scope] = fragment.parameters as [
          string,
          string,
          string,
          string,
        ];
        const key = `${organizationId}:${positionId}:${action}`;
        if (rows.has(key)) return [];
        rows.set(key, { organizationId, positionId, action, scope });
        return [{ inserted: true } as T];
      }
      throw new Error(`Unexpected query: ${fragment.sql}`);
    },
    async one<T>(): Promise<T> {
      throw new Error('Unexpected one() call');
    },
    async maybeOne<T>(): Promise<T | null> {
      throw new Error('Unexpected maybeOne() call');
    },
  };
  return { tx, rows };
}

describe('default tenant position policies', () => {
  it('provisions enabled-module defaults against the new tenant position', async () => {
    const { tx, rows } = fakeTx();
    const inserted = await provisionDefaultPositionPolicies(
      tx,
      'org-new',
      ['organization', 'projects'],
      [position],
      new Map([['dev-dept-head', 'position-new']]),
    );

    expect(inserted).toBe(4);
    expect([...rows.values()]).toEqual(
      expect.arrayContaining([
        {
          organizationId: 'org-new',
          positionId: 'position-new',
          action: 'org:view-structure',
          scope: 'department',
        },
        {
          organizationId: 'org-new',
          positionId: 'position-new',
          action: 'org:view-people',
          scope: 'department',
        },
        {
          organizationId: 'org-new',
          positionId: 'position-new',
          action: 'org:view-designations',
          scope: 'department',
        },
        {
          organizationId: 'org-new',
          positionId: 'position-new',
          action: 'projects:view',
          scope: 'department',
        },
      ]),
    );
    expect([...rows.values()].some((row) => row.action === 'org:view-policies')).toBe(
      false,
    );
  });

  it('does not create disabled-module policies or overwrite tenant customizations', async () => {
    const { tx, rows } = fakeTx([
      {
        organizationId: 'org-new',
        positionId: 'position-new',
        action: 'org:view-structure',
        scope: 'own',
      },
    ]);

    await provisionDefaultPositionPolicies(
      tx,
      'org-new',
      ['organization'],
      [position],
      new Map([['dev-dept-head', 'position-new']]),
    );
    const before = rows.get('org-new:position-new:org:view-structure');
    expect(before?.scope).toBe('own');
    expect([...rows.values()].some((row) => row.action === 'projects:view')).toBe(false);

    const count = rows.size;
    await provisionDefaultPositionPolicies(
      tx,
      'org-new',
      ['organization'],
      [position],
      new Map([['dev-dept-head', 'position-new']]),
    );
    expect(rows.size).toBe(count);
  });

  it('provisions the role-change request only for HR, not Access Explorer', async () => {
    const { tx, rows } = fakeTx();
    await provisionDefaultPositionPolicies(
      tx,
      'org-hr',
      ['access-management'],
      [hrPosition, position],
      new Map([
        ['hr', 'position-hr'],
        ['dev-dept-head', 'position-manager'],
      ]),
    );

    expect(rows.get('org-hr:position-hr:access:request-role-change')).toMatchObject({
      scope: 'department',
    });
    expect(rows.has('org-hr:position-hr:access:view')).toBe(false);
    expect(rows.has('org-hr:position-manager:access:request-role-change')).toBe(false);
  });

  it('grants HR employee management without granting it to HR Executive', async () => {
    const { tx, rows } = fakeTx();
    await provisionDefaultPositionPolicies(
      tx,
      'org-hr',
      ['employee-directory', 'organization'],
      [hrPosition, ORGANIZATION_TEMPLATE.positions.find((item) => item.code === 'hr-executive')!],
      new Map([
        ['hr', 'position-hr'],
        ['hr-executive', 'position-hr-executive'],
      ]),
    );

    expect(rows.get('org-hr:position-hr:users:manage')).toMatchObject({
      scope: 'all-people',
    });
    expect(rows.has('org-hr:position-hr-executive:users:manage')).toBe(false);
    expect(rows.get('org-hr:position-hr:org:view-designations')).toMatchObject({
      scope: 'department',
    });
    expect(rows.get('org-hr:position-hr:org:view-policies')).toMatchObject({
      scope: 'department',
    });
    expect(rows.has('org-hr:position-hr:access:view')).toBe(false);
  });
});
