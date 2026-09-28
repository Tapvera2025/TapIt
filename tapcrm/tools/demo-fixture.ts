import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tx } from '../packages/server/src/platform/dal/db.js';
import { sql } from '../packages/server/src/platform/dal/sql.js';

export const DEMO_EMAIL_DOMAIN = 'example.test';
export const DEMO_EMAIL_PREFIX = 'demo.';
export const DEMO_TEAM_PREFIX = 'demo-';

export interface DemoEmployee {
  readonly key: string;
  readonly email: string;
  readonly fullName: string;
  readonly employeeId: string;
  readonly positionCode: string;
  readonly teamSeedCode: string | null;
  readonly designationSeedCode: string | null;
  readonly specialization: string | null;
  readonly reportsToKey: string | null;
}

export const DEMO_EMPLOYEES: readonly DemoEmployee[] = [
  { key: 'hr-head', email: 'demo.hr.head@example.test', fullName: 'Demo HR Head', employeeId: 'DEMO-HR-001', positionCode: 'hr', teamSeedCode: null, designationSeedCode: null, specialization: null, reportsToKey: null },
  { key: 'hr-executive', email: 'demo.hr.executive@example.test', fullName: 'Demo HR Executive', employeeId: 'DEMO-HR-002', positionCode: 'hr-executive', teamSeedCode: null, designationSeedCode: null, specialization: null, reportsToKey: 'hr-head' },
  { key: 'sales-head', email: 'demo.sales.head@example.test', fullName: 'Demo Sales Head', employeeId: 'DEMO-SALES-001', positionCode: 'sales-head', teamSeedCode: null, designationSeedCode: null, specialization: null, reportsToKey: null },
  { key: 'sales-lead', email: 'demo.sales.lead@example.test', fullName: 'Demo Sales Team Lead', employeeId: 'DEMO-SALES-002', positionCode: 'sales-team-lead', teamSeedCode: 'demo-sales-team', designationSeedCode: null, specialization: null, reportsToKey: 'sales-head' },
  { key: 'sales-supervisor', email: 'demo.sales.supervisor@example.test', fullName: 'Demo Sales Supervisor', employeeId: 'DEMO-SALES-003', positionCode: 'sales-supervisor', teamSeedCode: 'demo-sales-pool', designationSeedCode: null, specialization: null, reportsToKey: 'sales-lead' },
  { key: 'sales-agent', email: 'demo.sales.agent@example.test', fullName: 'Demo Sales Agent', employeeId: 'DEMO-SALES-004', positionCode: 'sales-agent', teamSeedCode: 'demo-sales-pool', designationSeedCode: null, specialization: null, reportsToKey: 'sales-supervisor' },
  { key: 'project-manager', email: 'demo.project.manager@example.test', fullName: 'Demo Project Manager', employeeId: 'DEMO-PROJECTS-001', positionCode: 'project-manager', teamSeedCode: null, designationSeedCode: null, specialization: null, reportsToKey: null },
  { key: 'dev-head', email: 'demo.development.head@example.test', fullName: 'Demo Development Head', employeeId: 'DEMO-DEV-001', positionCode: 'dev-dept-head', teamSeedCode: null, designationSeedCode: null, specialization: null, reportsToKey: null },
  { key: 'developer-manager', email: 'demo.developer.manager@example.test', fullName: 'Demo Developer Team Manager', employeeId: 'DEMO-DEV-002', positionCode: 'developer-team-manager', teamSeedCode: 'developer-team', designationSeedCode: null, specialization: null, reportsToKey: 'dev-head' },
  { key: 'developer', email: 'demo.developer@example.test', fullName: 'Demo Developer', employeeId: 'DEMO-DEV-003', positionCode: 'developer', teamSeedCode: 'developer-team', designationSeedCode: 'developer', specialization: 'Full-stack', reportsToKey: 'developer-manager' },
  { key: 'marketing-manager', email: 'demo.marketing.manager@example.test', fullName: 'Demo Digital Marketing Manager', employeeId: 'DEMO-DEV-004', positionCode: 'digital-marketing-manager', teamSeedCode: 'digital-marketing', designationSeedCode: null, specialization: null, reportsToKey: 'dev-head' },
  { key: 'marketing-executive', email: 'demo.marketing.executive@example.test', fullName: 'Demo Marketing Executive', employeeId: 'DEMO-DEV-005', positionCode: 'marketing-executive', teamSeedCode: 'digital-marketing', designationSeedCode: 'marketing-executive', specialization: 'Analytics', reportsToKey: 'marketing-manager' },
  { key: 'content-manager', email: 'demo.content.manager@example.test', fullName: 'Demo Content Team Manager', employeeId: 'DEMO-DEV-006', positionCode: 'content-team-manager', teamSeedCode: 'content-team', designationSeedCode: null, specialization: null, reportsToKey: 'dev-head' },
  { key: 'content-writer', email: 'demo.content.writer@example.test', fullName: 'Demo Content Writer', employeeId: 'DEMO-DEV-007', positionCode: 'content-writer', teamSeedCode: 'content-team', designationSeedCode: 'content-writer', specialization: 'Technical', reportsToKey: 'content-manager' },
];

export function loadDotEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const separator = value.indexOf('=');
    if (separator < 0) continue;
    const key = value.slice(0, separator).trim();
    const val = value.slice(separator + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function organizationArgument(requireConfirmation = false): string {
  const args = process.argv.slice(2);
  const value = args.find((arg) => arg.startsWith('--organization='))?.slice('--organization='.length);
  if (!value || !/^[A-Za-z0-9_-]{2,50}$/.test(value)) {
    throw new Error('Pass an explicit organization code: --organization=SAN001');
  }
  if (requireConfirmation && !args.includes('--confirm-demo')) {
    throw new Error('Cleanup requires --confirm-demo because it deletes only the named demo fixture');
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Demo fixtures are disabled when NODE_ENV=production');
  }
  return value.toUpperCase();
}

export function demoPassword(): string {
  const password = process.env['DEMO_EMPLOYEE_PASSWORD'];
  if (!password || password.length < 12) {
    throw new Error('Set DEMO_EMPLOYEE_PASSWORD to a non-production password of at least 12 characters');
  }
  return password;
}

export async function organizationByCode(tx: Tx, code: string): Promise<{ id: string; name: string }> {
  const row = await tx.maybeOne<{ id: string; name: string }>(sql`
    SELECT id, name FROM organization WHERE code = ${code} AND status = 'active'
  `);
  if (!row) throw new Error(`Active organization "${code}" was not found`);
  return row;
}
