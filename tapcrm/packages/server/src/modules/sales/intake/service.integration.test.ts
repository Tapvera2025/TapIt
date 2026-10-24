import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createJobContext } from '../../../platform/dal/context.js';
import type { Principal } from '@tapcrm/contracts';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { ingest, IntakeConnectorNotFoundError } from './service.js';

/**
 * Sales v1.1 — canonical intake service end-to-end against PostgreSQL.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * Covers:
 *   - fresh ingest creates submission + contact + lead with outcome 'created'
 *   - replay of the same (connector, external_lead_id) yields 'duplicate_delivery'
 *   - missing contact fields yield 'quarantined'
 *   - a second enquiry from the same contact on an active lead yields 'linked_existing'
 *   - unknown connector throws IntakeConnectorNotFoundError
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
// Digits only: RUN is embedded in E.164 phone numbers (contact_primary_phone_check).
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const ACTOR = randomUUID();
const SOURCE = randomUUID();
const CONNECTOR = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const actorPrincipal: Principal = {
  id: ACTOR,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'service',
  allowedActions: [],
  allowedResources: [],
  expiresAt: new Date(Date.now() + 60_000),
};

const makeCtx = () =>
  createJobContext({
    organizationId: ORG,
    principal: actorPrincipal,
    jobName: 'sales.intake.test',
    runId: RUN,
  });

describe.skipIf(!enabled)('sales intake service (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`
        INSERT INTO organization (id, code, name, timezone)
        VALUES (${ORG}, ${`SI${RUN}`}, 'Sales Intake Test', 'Asia/Kolkata')
      `,
    );

    // Minimal app_user so the FK on sales_connector.created_by + contact.created_by holds.
    // 'service' account_type keeps us free of position_id/department_id requirements.
    await asOwner(
      'create actor user',
      sql`
        INSERT INTO app_user (id, organization_id, full_name, status, account_type)
        VALUES (${ACTOR}, ${ORG}, 'Intake Test Actor', 'active', 'service')
      `,
    );

    await asOwner(
      'create lead source',
      sql`
        INSERT INTO lead_source (id, organization_id, name, direction, status)
        VALUES (${SOURCE}, ${ORG}, ${`Website ${RUN}`}, 'inbound', 'active')
      `,
    );

    await asOwner(
      'create active connector',
      sql`
        INSERT INTO sales_connector (
          id, organization_id, kind, name, external_account_id,
          config, status, created_by
        ) VALUES (
          ${CONNECTOR}, ${ORG}, 'website', ${`Site ${RUN}`}, ${`site-${RUN}`},
          ${JSON.stringify({ sourceId: SOURCE, defaultCountryCode: '91' })}::jsonb,
          'active', ${ACTOR}
        )
      `,
    );
  });

  afterAll(async () => {
    // Order matters: lead_submission + sales_routing_decision + bid_pool_view
    // reference lead; lead references contact and company; contact references
    // company. Delete leaves first, then the tenant root.
    await asOwner('cleanup routing',     sql`DELETE FROM sales_routing_decision WHERE organization_id = ${ORG}`);
    await asOwner('cleanup bid views',   sql`DELETE FROM bid_pool_view          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup submissions', sql`DELETE FROM lead_submission        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads',       sql`DELETE FROM lead                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',    sql`DELETE FROM contact                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup company',     sql`DELETE FROM company                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup connectors',  sql`DELETE FROM sales_connector        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup sources',     sql`DELETE FROM lead_source            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',       sql`DELETE FROM app_user                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',         sql`DELETE FROM organization           WHERE id              = ${ORG}`);
    await closePools();
  });

  it('creates a submission, contact and lead on first delivery', async () => {
    const result = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: `evt-${RUN}-1`,
      mappedFields: {
        contactName: 'Rahul Shah',
        phoneRaw: '+919876543210',
        emailRaw: 'rahul@example.com',
        serviceRequested: 'Website development',
        location: 'Pune',
        budgetBracket: '50k-1L',
        message: 'Need a website for my clinic',
      },
    });

    expect(result.outcome).toBe('created');
    expect(result.leadId).toBeTruthy();
    expect(result.submissionId).toBeTruthy();

    const leads = await asOwner(
      'confirm lead',
      sql`SELECT contact_id, entry_method, direction, bid_state, lead_stage, lead_outcome FROM lead WHERE id = ${result.leadId!}`,
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      entryMethod: 'website',
      direction: 'inbound',
      bidState: 'none',
      leadStage: 'new',
      leadOutcome: 'active',
    });

    const contacts = await asOwner(
      'confirm contact',
      sql`SELECT primary_phone, primary_email, preferred_timezone FROM contact WHERE organization_id = ${ORG}`,
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      primaryPhone: '+919876543210',
      primaryEmail: 'rahul@example.com',
      preferredTimezone: 'Asia/Kolkata',
    });
  });

  it('returns duplicate_delivery on a replayed external key', async () => {
    const externalKey = `evt-${RUN}-replay`;
    const first = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: externalKey,
      mappedFields: { contactName: 'Priya N', phoneRaw: '+919876543211', serviceRequested: 'SEO' },
    });
    expect(first.outcome).toBe('created');

    const replay = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: externalKey,
      mappedFields: { contactName: 'Priya N', phoneRaw: '+919876543211', serviceRequested: 'SEO' },
    });
    expect(replay.outcome).toBe('duplicate_delivery');
    expect(replay.leadId).toBe(first.leadId);

    const submissionCount = await asOwner(
      'count submissions',
      sql`SELECT count(*)::int AS n FROM lead_submission WHERE organization_id = ${ORG} AND external_lead_id = ${`evt-${RUN}-replay`}`,
    );
    expect((submissionCount[0] as { n: number }).n).toBe(1);
    const leadCount = await asOwner(
      'count leads for contact',
      sql`SELECT count(*)::int AS n FROM lead l JOIN contact c ON c.organization_id = l.organization_id AND c.id = l.contact_id WHERE l.organization_id = ${ORG} AND c.primary_phone = ${'+919876543211'}`,
    );
    expect((leadCount[0] as { n: number }).n).toBe(1);
  });

  it('quarantines when neither phone nor email is supplied', async () => {
    const result = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: `evt-${RUN}-blank`,
      mappedFields: { contactName: 'Blank', serviceRequested: 'Website' },
    });
    expect(result.outcome).toBe('quarantined');
    expect(result.leadId).toBeUndefined();
    expect(result.reason).toBe('missing_contact');
  });

  it('links a second enquiry to the active lead when contact matches', async () => {
    const first = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: `evt-${RUN}-link-1`,
      mappedFields: { contactName: 'Amit Rao', phoneRaw: '+919876543212', serviceRequested: 'SEO' },
    });
    expect(first.outcome).toBe('created');

    const second = await ingest(makeCtx(), {
      connectorId: CONNECTOR,
      externalLeadId: `evt-${RUN}-link-2`,
      mappedFields: { contactName: 'Amit Rao', phoneRaw: '+919876543212', serviceRequested: 'SEO' },
    });
    expect(second.outcome).toBe('linked_existing');
    expect(second.leadId).toBe(first.leadId);
  });

  it('throws when the connector does not exist', async () => {
    const ctx = makeCtx();
    await expect(() =>
      ingest(ctx, {
        connectorId: randomUUID(),
        mappedFields: { phoneRaw: '+919876543213' },
      }),
    ).rejects.toBeInstanceOf(IntakeConnectorNotFoundError);
  });
});
