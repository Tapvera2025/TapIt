import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { runImport } from './process.js';
import {
  assign,
  assignees,
  createImport,
  discardImport,
  getImport,
  leadCalls,
  listImported,
  listImports,
  listRows,
  previewImport,
  startImport,
  trackCalls,
} from './service.js';
import type { ImportSettingsInput } from './validators.js';

/**
 * Lead Imports against real PostgreSQL: upload → review → import through the
 * intake pipeline → hand out (from the sheet and by hand) → call tracking.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run imports.integration
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const SALES = randomUUID();
const HR = randomUUID();
const AGENT_POSITION = randomUUID();
const HR_POSITION = randomUUID();
const TEAM = randomUUID();
const POOL = randomUUID();
const RAHUL = randomUUID();
const PRIYA = randomUUID();
const HANNA = randomUUID();
const SUPER_ADMIN = randomUUID();
const OTHER_ADMIN = randomUUID();
const SOURCE = randomUUID();
const OLD_CONTACT = randomUUID();
const OLD_LEAD = randomUUID();
const CONNECTION = randomUUID();
const RAHUL_AGENT = randomUUID();
const PRIYA_AGENT = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);
const ctxFor = (principal: Principal, organizationId = ORG) =>
  createJobContext({ organizationId, principal, jobName: 'lead-imports.test', runId: `${RUN}-${randomUUID()}` });
const admin = (id = SUPER_ADMIN, organizationId = ORG) => ctxFor({ id, organizationId, sessionVersion: 0, accountType: 'super-admin' }, organizationId);

const CSV = [
  'Client Name,Business Name,Owner Name,Number,Assigned To,Budget',
  'Amit Shah,Shah Traders,Rakesh Shah,98765 43210,Rahul,5 lakh',
  'Neha Gupta,Neha Boutique,,91234-56789,Rahul Verma,',
  'Repeat Row,Shah Traders,,9876543210,Rahul,',
  'Old Friend,Old Co,,9000000001,,',
  'No Number,Ghost Co,,,Rahul,',
  'Kiran,Kiran Stores,,9811111111,Sunil,',
  'Meera,Meera Foods,,9822222222,,',
  'Arjun,Arjun Auto,,9833333333,,',
].join('\n');

function settings(overrides: Partial<ImportSettingsInput> = {}): ImportSettingsInput {
  return {
    name: 'Expo list',
    columnMapping: { '0': 'contactName', '1': 'companyName', '2': 'ownerName', '3': 'phone', '4': 'assignedTo' },
    leadSourceId: SOURCE,
    campaignId: null,
    defaultCountryCode: '91',
    extraColumnsToNotes: true,
    assigneeMapping: {},
    ...overrides,
  };
}

async function waitForImport(id: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const detail = await getImport(admin(), id);
    if (detail.status === 'completed' || detail.status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('import did not finish');
}

const leadIdOf = async (phoneDigits: string): Promise<string> => {
  const rows = await asOwner('lead by phone', sql`SELECT id FROM lead WHERE organization_id = ${ORG} AND phone_normalized = ${phoneDigits}`);
  return (rows[0] as { id: string }).id;
};

describe.skipIf(!enabled)('Lead Imports (PostgreSQL)', () => {
  let importId = '';

  beforeAll(async () => {
    installAuthz();
    await asOwner('org', sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`LI${RUN}`}, 'Import Test', 'Asia/Kolkata'), (${OTHER_ORG}, ${`LO${RUN}`}, 'Other Co', 'UTC')`);
    await asOwner(
      'modules',
      sql`INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
          SELECT ${ORG}, id, 'enabled', now() FROM module WHERE key IN ('leads', 'lead-imports', 'telephony')`,
    );
    await asOwner('departments', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${SALES}, ${ORG}, 'sales', 'Sales', 'delivery'), (${HR}, ${ORG}, 'hr', 'HR', 'support')`);
    await asOwner(
      'positions',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${AGENT_POSITION}, ${ORG}, ${SALES}, 'sales-agent', 'Sales Agent', 1), (${HR_POSITION}, ${ORG}, ${HR}, 'hr', 'HR', 5)`,
    );
    await asOwner(
      'teams',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name) VALUES (${TEAM}, ${ORG}, ${SALES}, 'sales-team', 'North')`,
    );
    await asOwner(
      'pool',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name, parent_team_id) VALUES (${POOL}, ${ORG}, ${SALES}, 'sales-pool', 'North Pool', ${TEAM})`,
    );
    await asOwner(
      'employees',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, email, status, position_id, department_id, team_id, employee_id)
          VALUES (${RAHUL}, ${ORG}, 'employee', 'Rahul Verma', ${`rahul.${RUN}@tapvera.test`}, 'active', ${AGENT_POSITION}, ${SALES}, ${POOL}, ${`E-R${RUN}`}),
                 (${PRIYA}, ${ORG}, 'employee', 'Priya Nair', ${`priya.${RUN}@tapvera.test`}, 'active', ${AGENT_POSITION}, ${SALES}, ${TEAM}, ${`E-P${RUN}`}),
                 (${HANNA}, ${ORG}, 'employee', 'Hanna HR', ${`hanna.${RUN}@tapvera.test`}, 'active', ${HR_POSITION}, ${HR}, NULL, ${`E-H${RUN}`})`,
    );
    await asOwner(
      'admins',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status)
          VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Admin', 'active'), (${OTHER_ADMIN}, ${OTHER_ORG}, 'super-admin', 'Other Admin', 'active')`,
    );
    await asOwner('source', sql`INSERT INTO lead_source (id, organization_id, name, direction) VALUES (${SOURCE}, ${ORG}, 'Expo lists', 'outbound')`);
    // A customer already in the CRM with an open lead.
    await asOwner('contact', sql`INSERT INTO contact (id, organization_id, full_name, primary_phone, created_by) VALUES (${OLD_CONTACT}, ${ORG}, 'Old Friend', '+919000000001', ${SUPER_ADMIN})`);
    await asOwner(
      'old lead',
      sql`INSERT INTO lead (id, organization_id, source_id, contact_id, contact_name, phone, phone_normalized, created_by, owner_id, current_holder_id, routing_status, status)
          VALUES (${OLD_LEAD}, ${ORG}, ${SOURCE}, ${OLD_CONTACT}, 'Old Friend', '+919000000001', '919000000001', ${SUPER_ADMIN}, ${PRIYA}, ${PRIYA}, 'assigned', 'assigned')`,
    );
  });

  afterAll(async () => {
    for (const organization of [ORG, OTHER_ORG]) {
      await asOwner('rows', sql`DELETE FROM lead_import_row WHERE organization_id = ${organization}`);
      await asOwner('imports', sql`DELETE FROM lead_import WHERE organization_id = ${organization}`);
      await asOwner('calls', sql`DELETE FROM telephony_call WHERE organization_id = ${organization}`);
      await asOwner('agents', sql`DELETE FROM telephony_agent WHERE organization_id = ${organization}`);
      await asOwner('connections', sql`DELETE FROM telephony_connection WHERE organization_id = ${organization}`);
      await asOwner('callbacks', sql`DELETE FROM lead_callback WHERE organization_id = ${organization}`);
      await asOwner('submissions', sql`DELETE FROM lead_submission WHERE organization_id = ${organization}`);
      await asOwner('leads', sql`DELETE FROM lead WHERE organization_id = ${organization}`);
      await asOwner('contacts', sql`DELETE FROM contact WHERE organization_id = ${organization}`);
      await asOwner('companies', sql`DELETE FROM company WHERE organization_id = ${organization}`);
      await asOwner('connectors', sql`DELETE FROM sales_connector WHERE organization_id = ${organization}`);
      await asOwner('sources', sql`DELETE FROM lead_source WHERE organization_id = ${organization}`);
      await asOwner('notifications', sql`DELETE FROM notification_outbox WHERE organization_id = ${organization}`);
      await asOwner('audit', sql`DELETE FROM audit_outbox WHERE organization_id = ${organization}`);
      await asOwner('modules', sql`DELETE FROM organization_module WHERE organization_id = ${organization}`);
      await asOwner('email directory', sql`DELETE FROM identity_email_directory WHERE organization_id = ${organization}`);
      await asOwner('users', sql`DELETE FROM app_user WHERE organization_id = ${organization}`);
      await asOwner('teams', sql`DELETE FROM team WHERE organization_id = ${organization} AND parent_team_id IS NOT NULL`);
      await asOwner('teams', sql`DELETE FROM team WHERE organization_id = ${organization}`);
      await asOwner('positions', sql`DELETE FROM position WHERE organization_id = ${organization}`);
      await asOwner('departments', sql`DELETE FROM department WHERE organization_id = ${organization}`);
      await asOwner('org', sql`DELETE FROM organization WHERE id = ${organization}`);
    }
    await closePools();
  });

  it('reads an upload into a draft and matches its columns', async () => {
    const detail = await createImport(admin(), { kind: 'file', fileName: 'Expo_List.csv', fileBase64: Buffer.from(CSV).toString('base64') });
    importId = detail.id;
    expect(detail).toMatchObject({ status: 'draft', sourceKind: 'csv', name: 'Expo List', totalRows: 8, fileName: 'Expo_List.csv' });
    expect(detail.headers).toEqual(['Client Name', 'Business Name', 'Owner Name', 'Number', 'Assigned To', 'Budget']);
    expect(detail.settings.columnMapping).toEqual({ '0': 'contactName', '1': 'companyName', '2': 'ownerName', '3': 'phone', '4': 'assignedTo' });
    // No earlier import: the country code comes from the company's timezone.
    expect(detail.settings.defaultCountryCode).toBe('91');
    expect(detail.sampleRows[0]).toEqual(['Amit Shah', 'Shah Traders', 'Rakesh Shah', '98765 43210', 'Rahul', '5 lakh']);
  });

  it('previews what the import will do without writing a lead', async () => {
    const preview = await previewImport(admin(), importId, settings());
    expect(preview).toMatchObject({ total: 8, ready: 5, alreadyInCrm: 1, duplicateInFile: 1, missingContact: 1, invalidPhone: 0, willBeAssigned: 2 });
    expect(preview.problemRows.find((row) => row.rowNumber === 4)).toMatchObject({ status: 'already_in_crm', existingOwnerName: 'Priya Nair' });
    expect(preview.assignees.map((entry) => [entry.value, entry.employeeId, entry.rows])).toEqual([
      ['Sunil', null, 1],
      ['Rahul', RAHUL, 1],
      ['Rahul Verma', RAHUL, 1],
    ]);
    const leads = await asOwner('no leads yet', sql`SELECT count(*)::int AS n FROM lead WHERE organization_id = ${ORG}`);
    expect(leads[0]).toEqual({ n: 1 });

    const chosen = await previewImport(admin(), importId, settings({ assigneeMapping: { sunil: PRIYA } }));
    expect(chosen.willBeAssigned).toBe(3);
    expect(chosen.assignees.find((entry) => entry.value === 'Sunil')).toMatchObject({ employeeId: PRIYA, match: 'manual' });
  });

  it('needs a source and a phone or email column to start', async () => {
    await expect(startImport(admin(), importId, settings({ leadSourceId: null }))).rejects.toMatchObject({ status: 422 });
    await expect(startImport(admin(), importId, settings({ columnMapping: { '0': 'contactName' } }))).rejects.toMatchObject({ status: 422 });
  });

  it('imports through intake: new leads, duplicates linked, problems reported', async () => {
    const started = await startImport(admin(), importId, settings({ assigneeMapping: { sunil: PRIYA } }));
    expect(['queued', 'importing', 'completed']).toContain(started.status);
    await waitForImport(importId);

    const detail = await getImport(admin(), importId);
    expect(detail).toMatchObject({ status: 'completed', processedRows: 8, createdCount: 5, existingCount: 1, duplicateCount: 1, invalidCount: 1, failedCount: 0 });

    const rows = await listRows(admin(), importId, { status: 'all', page: 1, pageSize: 50 });
    expect(rows.items.map((row) => row.status)).toEqual(['created', 'created', 'duplicate', 'existing', 'invalid', 'created', 'created', 'created']);
    expect(rows.items[4]).toMatchObject({ reason: 'No phone number or email', contactName: 'No Number' });
    expect(rows.items[3]).toMatchObject({ leadId: OLD_LEAD, ownerName: 'Priya Nair' });

    const amit = await asOwner(
      'amit',
      sql`SELECT entry_method, direction, source_id, intake_notes, company_name, phone, status, owner_id FROM lead WHERE organization_id = ${ORG} AND phone_normalized = '919876543210'`,
    );
    expect(amit[0]).toMatchObject({
      entryMethod: 'import',
      direction: 'outbound',
      sourceId: SOURCE,
      companyName: 'Shah Traders',
      phone: '+919876543210',
      intakeNotes: 'Business owner: Rakesh Shah\nBudget: 5 lakh',
    });
    const activity = await asOwner('activity', sql`SELECT event_name, metadata FROM lead_activity WHERE organization_id = ${ORG} AND lead_id = ${await leadIdOf('919876543210')} ORDER BY created_at`);
    expect(activity.map((row) => (row as { eventName: string }).eventName)).toEqual(['lead.created', 'lead.assigned']);
    expect((activity[0] as { metadata: Record<string, unknown> }).metadata).toMatchObject({ importName: 'Expo list', rowNumber: 1 });
  });

  it('hands out leads named in the "Assigned to" column, with the owner\'s team', async () => {
    const amit = await asOwner('amit owner', sql`SELECT owner_id, sales_pool_id, sales_team_id, status, routing_status FROM lead WHERE organization_id = ${ORG} AND phone_normalized = '919876543210'`);
    expect(amit[0]).toEqual({ ownerId: RAHUL, salesPoolId: POOL, salesTeamId: TEAM, status: 'assigned', routingStatus: 'assigned' });
    const kiran = await asOwner('kiran owner', sql`SELECT owner_id, sales_pool_id, sales_team_id FROM lead WHERE organization_id = ${ORG} AND phone_normalized = '919811111111'`);
    expect(kiran[0]).toEqual({ ownerId: PRIYA, salesPoolId: TEAM, salesTeamId: TEAM });

    const notices = await asOwner(
      'notifications',
      sql`SELECT payload->>'title' AS title, payload->'audience'->'users'->>0 AS "userId" FROM notification_outbox WHERE organization_id = ${ORG} ORDER BY id`,
    );
    expect(notices).toEqual([
      { title: '2 leads were assigned to you', userId: RAHUL },
      { title: 'A lead was assigned to you', userId: PRIYA },
    ]);

    const page = await listImported(admin(), { importId, assignment: 'all', page: 1, pageSize: 50 });
    expect(page.counts).toEqual({ all: 5, unassigned: 2, assigned: 3 });
    expect(page.callTracking).toBe(true);
    const unassigned = await listImported(admin(), { importId, assignment: 'unassigned', page: 1, pageSize: 50 });
    expect(unassigned.items.map((item) => item.contactName).sort()).toEqual(['Arjun', 'Meera']);
    const sheet = page.items.find((item) => item.contactName === 'Amit Shah');
    expect(sheet).toMatchObject({ ownerName: 'Rahul Verma', assignedVia: 'sheet', assignedByName: 'Admin', callStatus: 'not_called', importName: 'Expo list' });

    const summary = (await listImports(admin(), 50)).items.find((item) => item.id === importId);
    expect(summary).toMatchObject({ assignedCount: 3, unassignedCount: 2, leadSourceName: 'Expo lists', createdByName: 'Admin' });
  });

  it('lists the Sales department to assign to, and nobody else', async () => {
    const people = await assignees(admin());
    expect(people.items.map((person) => person.fullName)).toEqual(['Priya Nair', 'Rahul Verma']);
    expect(people.items.find((person) => person.id === PRIYA)?.openLeads).toBe(2);
    await expect(assign(admin(), { filter: { importId, assignment: 'unassigned' }, employeeIds: [HANNA], includeAssigned: false })).rejects.toMatchObject({ status: 422 });
  });

  it('splits the rest evenly and leaves assigned leads alone unless asked', async () => {
    const result = await assign(admin(), { filter: { importId, assignment: 'all' }, employeeIds: [PRIYA, RAHUL], includeAssigned: false });
    expect(result).toMatchObject({ assigned: 2, reassigned: 0, skipped: { alreadyAssigned: 3, closed: 0, notImported: 0 } });
    expect(result.byEmployee).toEqual([
      { employeeId: PRIYA, fullName: 'Priya Nair', count: 1 },
      { employeeId: RAHUL, fullName: 'Rahul Verma', count: 1 },
    ]);
    const counts = (await listImported(admin(), { importId, assignment: 'all', page: 1, pageSize: 1 })).counts;
    expect(counts).toEqual({ all: 5, unassigned: 0, assigned: 5 });

    // Reassigning moves the open callback and records a reassignment.
    const neha = await leadIdOf('919123456789');
    await asOwner('callback', sql`INSERT INTO lead_callback (organization_id, lead_id, owner_id, scheduled_at, created_by) VALUES (${ORG}, ${neha}, ${RAHUL}, now() + interval '1 day', ${RAHUL})`);
    const moved = await assign(admin(), { leadIds: [neha, OLD_LEAD, randomUUID()], employeeIds: [PRIYA], includeAssigned: true });
    expect(moved).toMatchObject({ assigned: 0, reassigned: 1, skipped: { notImported: 2 } });
    const callback = await asOwner('callback owner', sql`SELECT owner_id FROM lead_callback WHERE organization_id = ${ORG} AND lead_id = ${neha}`);
    expect(callback[0]).toEqual({ ownerId: PRIYA });
    const decision = await asOwner('decision', sql`SELECT mode, actor_id FROM sales_routing_decision WHERE organization_id = ${ORG} AND lead_id = ${neha} ORDER BY created_at DESC LIMIT 1`);
    expect(decision[0]).toEqual({ mode: 'reassignment', actorId: SUPER_ADMIN });
  });

  it('tracks whether each assignee called their leads after assignment', async () => {
    const amit = await leadIdOf('919876543210');
    const neha = await leadIdOf('919123456789');
    const kiran = await leadIdOf('919811111111');
    // Assigned an hour ago; Kiran two days ago, so still uncalled counts as overdue.
    await asOwner('assigned earlier', sql`UPDATE lead SET assigned_at = now() - interval '1 hour' WHERE organization_id = ${ORG} AND entry_method = 'import'`);
    await asOwner('assigned two days ago', sql`UPDATE lead SET assigned_at = now() - interval '2 days' WHERE id = ${kiran}`);
    await asOwner(
      'connection',
      sql`INSERT INTO telephony_connection (id, organization_id, provider, label, status, credentials_encrypted, created_by)
          VALUES (${CONNECTION}, ${ORG}, 'justcall', 'JustCall', 'active', 'v1.test', ${SUPER_ADMIN})`,
    );
    await asOwner(
      'agents',
      sql`INSERT INTO telephony_agent (id, organization_id, connection_id, provider, external_id, name, employee_id, match_method)
          VALUES (${RAHUL_AGENT}, ${ORG}, ${CONNECTION}, 'justcall', '1', 'Rahul JC', ${RAHUL}, 'manual'),
                 (${PRIYA_AGENT}, ${ORG}, ${CONNECTION}, 'justcall', '2', 'Priya JC', ${PRIYA}, 'manual')`,
    );
    await asOwner(
      'calls',
      sql`INSERT INTO telephony_call (organization_id, connection_id, provider, external_id, agent_id, direction, outcome, started_at, talk_seconds, contact_number)
          VALUES (${ORG}, ${CONNECTION}, 'justcall', 'c1', ${RAHUL_AGENT}, 'outbound', 'unanswered', now() - interval '5 minutes', 0, '+919876543210'),
                 (${ORG}, ${CONNECTION}, 'justcall', 'c2', ${RAHUL_AGENT}, 'outbound', 'answered', now() - interval '2 minutes', 95, '9876543210'),
                 (${ORG}, ${CONNECTION}, 'justcall', 'c3', ${RAHUL_AGENT}, 'outbound', 'answered', now() - interval '30 days', 60, '+919123456789'),
                 (${ORG}, ${CONNECTION}, 'justcall', 'c4', ${RAHUL_AGENT}, 'outbound', 'unanswered', now() - interval '1 minute', 0, '+919811111111')`,
    );

    const overview = await trackCalls(admin(), { assignedBy: 'anyone', status: 'all', sort: 'assigned_desc', page: 1, pageSize: 25 });
    expect(overview.telephony).toMatchObject({ enabled: true, connected: true });
    expect(overview.totals).toMatchObject({ assigned: 5, withPhone: 5, called: 1, connected: 1, noAnswer: 0, notCalled: 4, calledByOthers: 1, overdue: 1, talkSeconds: 95 });
    const byLead = new Map(overview.leads.map((lead) => [lead.leadId, lead]));
    expect(byLead.get(amit)).toMatchObject({ status: 'connected', attempts: 2, ownerCalls: 2, connectedCalls: 1, talkSeconds: 95, ownerName: 'Rahul Verma' });
    // Neha is Priya's now; Rahul's call was before the lead was even assigned.
    expect(byLead.get(neha)).toMatchObject({ status: 'not_called', ownerName: 'Priya Nair', otherCalls: 0 });
    // Kiran is Priya's and Rahul called: someone else.
    expect(byLead.get(kiran)).toMatchObject({ status: 'other', ownerCalls: 0, otherCalls: 1 });
    expect(overview.employees.find((row) => row.employeeId === RAHUL)).toMatchObject({ assigned: 2, called: 1, connected: 1, notCalled: 1 });
    expect(overview.employees.find((row) => row.employeeId === PRIYA)).toMatchObject({ assigned: 3, called: 0, notCalled: 3, overdue: 1 });

    const waiting = await trackCalls(admin(), { assignedBy: 'me', status: 'not_called', sort: 'waiting_longest', page: 1, pageSize: 25 });
    expect(waiting.total).toBe(3);
    const mine = await trackCalls(admin(), { assignedBy: 'anyone', ownerId: RAHUL, status: 'connected', sort: 'assigned_desc', page: 1, pageSize: 25 });
    expect(mine.leads.map((lead) => lead.contactName)).toEqual(['Amit Shah']);

    const history = await leadCalls(admin(), amit);
    expect(history.calls.map((item) => [item.outcome, item.byOwner, item.afterAssignment])).toEqual([
      ['answered', true, true],
      ['unanswered', true, true],
    ]);
    const imported = await listImported(admin(), { importId, assignment: 'all', callStatus: 'connected', page: 1, pageSize: 50 });
    expect(imported.items.map((item) => item.contactName)).toEqual(['Amit Shah']);
  });

  it('runs each import once, and keeps companies apart', async () => {
    expect(await runImport(admin(), importId, 'again')).toBe('busy');
    await expect(startImport(admin(), importId, settings())).rejects.toMatchObject({ status: 409 });

    const draft = await createImport(admin(), { kind: 'paste', text: 'Name\tPhone\nZed\t9844444444' });
    expect(draft.sourceKind).toBe('paste');
    await expect(discardImport(admin(), draft.id)).resolves.toEqual({ id: draft.id, status: 'cancelled' });

    const otherCompany = admin(OTHER_ADMIN, OTHER_ORG);
    expect((await listImports(otherCompany, 50)).items).toEqual([]);
    expect((await listImported(otherCompany, { assignment: 'all', page: 1, pageSize: 10 })).total).toBe(0);
    await expect(getImport(otherCompany, importId)).rejects.toMatchObject({ status: 404 });
  });
});
