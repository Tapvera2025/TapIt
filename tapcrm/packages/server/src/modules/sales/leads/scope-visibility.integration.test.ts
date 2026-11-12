import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authorize, visibilityFilter } from '@tapcrm/authz';
import type { Principal, Scope } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createJobContext } from '../../../platform/dal/context.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { registerLeadPolicies } from './policy.js';
import { loadLeadResource } from './repository.js';

/**
 * "Someone has access to see leads in their team or department, and they
 * can't see them" — PRD §3.5.1, the worked Sales visibility example, end to
 * end through the policy store, the scope resolver and the lead policy.
 *
 * The structure deliberately includes what real companies have and the old
 * resolution missed:
 *   - Team Lead A LEADS Team A (team.lead_user_id) but is not placed in it
 *     (app_user.team_id is NULL) — how the Teams screen creates a lead;
 *   - leads that routing never stamped with a pool or Sales Team (added by
 *     hand, imported);
 *   - an agent who reports to a Supervisor but was never placed in a team;
 *   - a lead owned outside Sales, which nobody in Sales may see.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const SALES = randomUUID();
const HR = randomUUID();
const SOURCE = randomUUID();
const POS = { head: randomUUID(), lead: randomUUID(), supervisor: randomUUID(), agent: randomUUID(), hr: randomUUID() };
const TEAM = { a: randomUUID(), b: randomUUID(), manishPool: randomUUID(), mukeshPool: randomUUID(), anandPool: randomUUID() };
const U = {
  head: randomUUID(), leadA: randomUUID(), leadB: randomUUID(), manish: randomUUID(), ram: randomUUID(),
  shyaam: randomUUID(), kiran: randomUUID(), mukesh: randomUUID(), jodhu: randomUUID(), anand: randomUUID(),
  rohit: randomUUID(), hrPerson: randomUUID(),
};
const LEADS: Record<string, string> = {};

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

type Placement = { position: string; department: string; team: string | null; reportsTo: string | null };
const placement: Record<string, Placement> = {};

const ctxFor = (userId: string) => {
  const p = placement[userId]!;
  const principal: Principal = {
    id: userId, organizationId: ORG, sessionVersion: 0, accountType: 'employee',
    positionId: p.position, departmentId: p.department, teamId: p.team, reportsTo: p.reportsTo,
    organizationalLevel: 1,
  };
  return createJobContext({ organizationId: ORG, principal, jobName: 'sales.scope-visibility.test', runId: RUN });
};

async function visibleLeads(userId: string): Promise<string> {
  const ctx = ctxFor(userId);
  const filter = await visibilityFilter(ctx, 'leads:view', 'lead');
  const ids = Object.values(LEADS);
  const rows = await db.query<{ id: string }>(ctx, sql`
    SELECT l.id FROM lead l
    WHERE l.organization_id = ${ORG} AND l.id = ANY(${ids}::uuid[]) AND ${filter}
  `);
  // The same filter without the id restriction must not reach anything more:
  // a predicate that escaped its parentheses would show up here.
  const all = await db.query<{ n: number }>(ctx, sql`
    SELECT count(*)::int AS n FROM lead l WHERE l.organization_id = ${ORG} AND ${filter}
  `);
  expect(all[0]!.n).toBe(rows.length);
  const label = new Map(Object.entries(LEADS).map(([name, id]) => [id, name]));
  return rows.map((row) => label.get(row.id)!).sort().join(' ');
}

describe.skipIf(!enabled)('lead visibility by scope — PRD §3.5.1 (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    try { registerLeadPolicies(); } catch { /* already registered by another suite */ }
    await asOwner('org', sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SV${RUN}`}, 'Scope Visibility Test', 'Asia/Kolkata')`);
    await asOwner('departments', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${SALES}, ${ORG}, 'sales', 'Sales', 'sales'), (${HR}, ${ORG}, 'hr', 'HR', 'support')`);
    await asOwner('positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES
        (${POS.head}, ${ORG}, ${SALES}, 'sales-head', 'Sales Head', 90),
        (${POS.lead}, ${ORG}, ${SALES}, 'sales-team-lead', 'Team Lead', 70),
        (${POS.supervisor}, ${ORG}, ${SALES}, 'sales-supervisor', 'Supervisor', 50),
        (${POS.agent}, ${ORG}, ${SALES}, 'sales-agent', 'Agent', 10),
        (${POS.hr}, ${ORG}, ${HR}, 'hr-executive', 'HR Executive', 50)`);
    const grant = (position: string, scope: Scope) =>
      asOwner('policy', sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope) VALUES (${ORG}, ${position}, 'leads:view', true, ${scope})`);
    await grant(POS.head, 'department');
    await grant(POS.lead, 'team');
    await grant(POS.supervisor, 'pool');
    await grant(POS.agent, 'own');
    await asOwner('teams', sql`
      INSERT INTO team (id, organization_id, department_id, kind, name, parent_team_id) VALUES
        (${TEAM.a}, ${ORG}, ${SALES}, 'sales-team', 'Team A', NULL),
        (${TEAM.b}, ${ORG}, ${SALES}, 'sales-team', 'Team B', NULL),
        (${TEAM.manishPool}, ${ORG}, ${SALES}, 'sales-pool', 'Manish pool', ${TEAM.a}),
        (${TEAM.mukeshPool}, ${ORG}, ${SALES}, 'sales-pool', 'Mukesh pool', ${TEAM.b}),
        (${TEAM.anandPool}, ${ORG}, ${SALES}, 'sales-pool', 'Anand pool', ${TEAM.b})`);
    const people: Array<[string, string, string, string, string | null, string | null]> = [
      [U.head, 'Sales Head', POS.head, SALES, null, null],
      [U.leadA, 'Team Lead A', POS.lead, SALES, null, U.head], // leads Team A, NOT placed in it
      [U.leadB, 'Team Lead B', POS.lead, SALES, TEAM.b, U.head],
      [U.manish, 'Manish', POS.supervisor, SALES, TEAM.manishPool, U.leadA],
      [U.ram, 'Ram', POS.agent, SALES, TEAM.manishPool, U.manish],
      [U.shyaam, 'Shyaam', POS.agent, SALES, TEAM.manishPool, U.manish],
      [U.kiran, 'Kiran', POS.agent, SALES, null, U.manish], // never placed in a team
      [U.mukesh, 'Mukesh', POS.supervisor, SALES, TEAM.mukeshPool, U.leadB],
      [U.jodhu, 'Jodhu', POS.agent, SALES, TEAM.mukeshPool, U.mukesh],
      [U.anand, 'Anand', POS.supervisor, SALES, TEAM.anandPool, U.leadB],
      [U.rohit, 'Rohit', POS.agent, SALES, TEAM.anandPool, U.anand],
      [U.hrPerson, 'HR person', POS.hr, HR, null, null],
    ];
    for (const [id, name, position, department, team, reportsTo] of people) {
      placement[id] = { position, department, team, reportsTo };
      await asOwner('person', sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to, employee_id)
        VALUES (${id}, ${ORG}, 'employee', ${name}, 'active', ${position}, ${department}, ${team}, ${reportsTo},
                'E-' || upper(left(replace(${id}::text, '-', ''), 12)))`);
    }
    await asOwner('team leads', sql`
      UPDATE team SET lead_user_id = CASE id
        WHEN ${TEAM.a}::uuid THEN ${U.leadA}::uuid WHEN ${TEAM.b}::uuid THEN ${U.leadB}::uuid
        WHEN ${TEAM.manishPool}::uuid THEN ${U.manish}::uuid WHEN ${TEAM.mukeshPool}::uuid THEN ${U.mukesh}::uuid
        WHEN ${TEAM.anandPool}::uuid THEN ${U.anand}::uuid END
      WHERE organization_id = ${ORG}`);
    await asOwner('source', sql`INSERT INTO lead_source (id, organization_id, name, direction, status) VALUES (${SOURCE}, ${ORG}, ${`Scope ${RUN}`}, 'inbound', 'active')`);
    const lead = async (name: string, owner: string | null, pool: string | null, salesTeam: string | null) => {
      const id = randomUUID();
      LEADS[name] = id;
      await asOwner('lead', sql`
        INSERT INTO lead (id, organization_id, source_id, contact_name, status, routing_status,
                          owner_id, current_holder_id, sales_pool_id, sales_team_id, created_by)
        VALUES (${id}, ${ORG}, ${SOURCE}, ${name}, ${owner ? 'assigned' : 'new'}, ${owner ? 'assigned' : 'unrouted'},
                ${owner}, ${owner}, ${pool}, ${salesTeam}, ${U.head})`);
    };
    await lead('L1', U.ram, TEAM.manishPool, TEAM.a); // routed normally
    await lead('L2', U.shyaam, null, null); // added by hand, never stamped
    await lead('L3', U.jodhu, TEAM.mukeshPool, TEAM.b);
    await lead('L4', U.rohit, null, null);
    await lead('L5', null, null, null); // waiting for an owner
    await lead('L6', U.kiran, null, null); // owner never placed in a team
    await lead('L7', U.hrPerson, null, null); // owned outside Sales
  });

  afterAll(async () => {
    await asOwner('cleanup audit', sql`DELETE FROM audit_outbox WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads', sql`DELETE FROM lead WHERE organization_id = ${ORG}`);
    await asOwner('cleanup source', sql`DELETE FROM lead_source WHERE organization_id = ${ORG}`);
    await asOwner('cleanup policies', sql`DELETE FROM position_policy WHERE organization_id = ${ORG}`);
    await asOwner('unlink leads', sql`UPDATE team SET lead_user_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pools', sql`DELETE FROM team WHERE organization_id = ${ORG} AND parent_team_id IS NOT NULL`);
    await asOwner('cleanup teams', sql`DELETE FROM team WHERE organization_id = ${ORG}`);
    await asOwner('cleanup positions', sql`DELETE FROM position WHERE organization_id = ${ORG}`);
    await asOwner('cleanup departments', sql`DELETE FROM department WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it.each([
    ['an agent (own)', () => U.ram, 'L1'],
    ['a Supervisor (pool) — their pool, including what was never stamped and whoever reports to them', () => U.manish, 'L1 L2 L6'],
    ['a Team Lead who leads a team without being placed in it (team)', () => U.leadA, 'L1 L2 L6'],
    ['a Team Lead placed in their team (team) — their pools, nobody else’s', () => U.leadB, 'L3 L4'],
    ['another Supervisor (pool) — disjoint from Manish (VIS-4)', () => U.mukesh, 'L3'],
    ['the Sales Head (department) — all of Sales and the unowned queue, not HR’s lead', () => U.head, 'L1 L2 L3 L4 L5 L6'],
  ])('%s sees exactly the leads the PRD table says', async (_who, user, expected) => {
    expect(await visibleLeads(user())).toBe(expected);
  });

  it('opening a single lead agrees with the list', async () => {
    const ctx = ctxFor(U.leadA);
    const visible = new Set((await visibleLeads(U.leadA)).split(' '));
    for (const [name, id] of Object.entries(LEADS)) {
      const resource = await loadLeadResource(ctx, id);
      const allowed = await authorize(ctx, 'leads:view', resource!).then(() => true, () => false);
      expect([name, allowed]).toEqual([name, visible.has(name)]);
    }
  });
});
