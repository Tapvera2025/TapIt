import { randomUUID } from 'node:crypto';
import { authorize } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock } from '../../platform/time.js';
import { registerBiometricPolicies } from './policy.js';
import { loadDeviceBySerial } from './routes.js';
import {
  changeDevice,
  createDevice,
  listDevices,
  listPunches,
  putMapping,
  requestReplay,
} from './service.js';
import { mappingSchema, patchDeviceSchema, replaySchema } from './validators.js';

/**
 * The biometric admin API (§10.8, step 5 plan Task 3) against real PostgreSQL:
 * tenant-wide administration only, the serial loader, device configuration,
 * dated PIN mappings and their forward-only rule, the punch stream and replay
 * requests. No machine surface and no global directory are involved.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

interface Tenant {
  org: string;
  department: string;
  adminPosition: string;
  leadPosition: string;
  admin: string;
  lead: string;
  alice: string;
  bob: string;
}
const tenant = (): Tenant => ({
  org: randomUUID(),
  department: randomUUID(),
  adminPosition: randomUUID(),
  leadPosition: randomUUID(),
  admin: randomUUID(),
  lead: randomUUID(),
  alice: randomUUID(),
  bob: randomUUID(),
});
const A = tenant();
const B = tenant();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function as(t: Tenant, userId: string, positionId: string) {
  const principal: Principal = {
    id: userId,
    organizationId: t.org,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId: t.department,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 40,
  };
  return createRequestContext({
    organizationId: t.org,
    principal,
    requestId: randomUUID(),
  });
}
const admin = (t: Tenant = A) => as(t, t.admin, t.adminPosition);
const lead = () => as(A, A.lead, A.leadPosition);
const superAdmin = () =>
  createRequestContext({
    organizationId: A.org,
    principal: {
      id: randomUUID(),
      organizationId: A.org,
      sessionVersion: 1,
      accountType: 'super-admin',
    },
    requestId: randomUUID(),
  });

async function seedTenant(t: Tenant) {
  await asOwner(
    'organization',
    sql`INSERT INTO organization (id, code, name, timezone)
        VALUES (${t.org}, ${`BA${t.org.slice(0, 6)}`}, 'Biometric API', 'Asia/Kolkata')`,
  );
  await asOwner(
    'department',
    sql`INSERT INTO department (id, organization_id, code, name, kind)
        VALUES (${t.department}, ${t.org}, 'HR', 'People', 'operations')`,
  );
  await asOwner(
    'positions',
    sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
        VALUES (${t.adminPosition}, ${t.org}, ${t.department}, 'HRA', 'HR admin', 50),
               (${t.leadPosition}, ${t.org}, ${t.department}, 'LEAD', 'Team lead', 40)`,
  );
  // A team-scoped grant is a misconfiguration the policy must refuse, not honour.
  for (const [position, scope] of [
    [t.adminPosition, 'all-people'],
    [t.leadPosition, 'team'],
  ] as const) {
    await asOwner(
      'grant',
      sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${t.org}, ${position}, 'biometric:manage', true, ${scope})`,
    );
  }
  const people: [string, string][] = [
    [t.admin, t.adminPosition],
    [t.lead, t.leadPosition],
    [t.alice, t.leadPosition],
    [t.bob, t.leadPosition],
  ];
  for (const [index, [id, position]] of people.entries()) {
    await asOwner(
      'person',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
          VALUES (${id}, ${t.org}, 'employee', ${`EMP-BA${index}`}, ${`a${index}-${id}@t.io`}, ${`Person ${index}`},
                  ${position}, ${t.department})`,
    );
  }
}

async function clearTenant(t: Tenant) {
  await asOwner(
    'clear outbox',
    sql`DELETE FROM domain_outbox WHERE organization_id = ${t.org}`,
  );
  await asOwner(
    'clear review items',
    sql`DELETE FROM biometric_review_item WHERE organization_id = ${t.org}`,
  );
  await asOwner(
    'clear punches and events',
    sql`WITH punches AS (DELETE FROM biometric_punch WHERE organization_id = ${t.org})
        DELETE FROM attendance_event WHERE organization_id = ${t.org}`,
  );
  for (const table of [
    'biometric_replay_request',
    'biometric_alert',
    'biometric_pin_mapping',
    'biometric_reader',
    'biometric_device',
    'biometric_connector',
    'position_policy',
    'identity_email_directory',
    'app_user',
    'position',
    'department',
  ]) {
    await asOwner(
      `clear ${table}`,
      sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${t.org}`,
    );
  }
  await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${t.org}`);
}

/** A punch as the pipeline would have stored it, at an IST wall-clock time. */
async function receivedPunch(p: {
  device: string;
  pin: string;
  local: string;
  status: string;
  userId?: string | null;
  receivedAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const at = new Date(`${p.local}+05:30`);
  await asOwner(
    'receive a punch',
    sql`INSERT INTO biometric_punch (id, organization_id, device_id, pin, occurred_at, corrected_at,
                                     applied_offset_seconds, raw_line, direction_at_receipt, meaning,
                                     dry_run_at_receipt, status, user_id, received_at)
        VALUES (${id}, ${A.org}, ${p.device}, ${p.pin}, ${at}, ${at}, 0, ${`line ${id}`}, 'undirected', 'scan',
                false, ${p.status}, ${p.userId ?? null}, ${p.receivedAt ?? new Date()})`,
  );
  return id;
}

/** An applied punch: its event exists and the punch points at it. */
async function appliedPunch(device: string, pin: string, local: string, userId: string) {
  const id = await receivedPunch({ device, pin, local, status: 'received', userId });
  const [event] = (await asOwner(
    'its event',
    sql`INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
        VALUES (${A.org}, ${userId}, 'scan', ${new Date(`${local}+05:30`)}, 'device', 'assumed', ${id})
        RETURNING id`,
  )) as { id: string }[];
  await asOwner(
    'apply it',
    sql`UPDATE biometric_punch SET status = 'applied', attendance_event_id = ${event!.id} WHERE id = ${id}`,
  );
  return id;
}

describe.skipIf(!enabled)('biometric admin API (PostgreSQL)', () => {
  let front: { id: string; connectorId: string };

  beforeAll(async () => {
    installAuthz();
    registerBiometricPolicies();
    await seedTenant(A);
    await seedTenant(B);
  });

  afterAll(async () => {
    await clearTenant(A);
    await clearTenant(B);
    await closePools();
  });

  describe('devices', () => {
    it('are administered tenant-wide only: a team-scoped grant fails closed', async () => {
      const body = {
        serialNumber: 'CQZ7224',
        name: 'Front door',
        adapter: 'zk-adms' as const,
        locationLabel: null,
      };
      await expect(createDevice(lead(), body)).rejects.toMatchObject({
        reason: 'out_of_scope',
      });
      await expect(listDevices(lead(), { limit: 50 })).rejects.toMatchObject({
        reason: 'out_of_scope',
      });

      const created = await createDevice(admin(), body);
      expect(created).toMatchObject({
        serialNumber: 'CQZ7224',
        status: 'pending',
        dryRun: true,
        timezone: 'Asia/Kolkata',
        connector: { kind: 'zk-adms' },
      });
      front = { id: created.id, connectorId: created.connector.id };

      // A second device joins the same connector; Super Admin sees both.
      const back = await createDevice(admin(), {
        ...body,
        serialNumber: 'CQZ7225',
        name: 'Back door',
      });
      expect(back.connector.id).toBe(front.connectorId);
      const listed = await listDevices(superAdmin(), { limit: 1 });
      expect(listed.devices.map((d) => d.serialNumber)).toEqual(['CQZ7224']);
      const rest = await listDevices(superAdmin(), { limit: 1, after: listed.next! });
      expect(rest).toMatchObject({ devices: [{ serialNumber: 'CQZ7225' }], next: null });
    });

    it('a serial is taken once per tenant; another tenant may use it', async () => {
      const body = {
        serialNumber: 'CQZ7224',
        name: 'Copy',
        adapter: 'zk-adms' as const,
        locationLabel: null,
      };
      await expect(createDevice(admin(), body)).rejects.toMatchObject({
        status: 409,
        code: 'BIOMETRIC_SERIAL_TAKEN',
      });
      await expect(createDevice(admin(B), body)).resolves.toMatchObject({
        serialNumber: 'CQZ7224',
      });
    });

    it('the PATCH object is the serial in the caller’s tenant, checked tenant-wide', async () => {
      const mine = await loadDeviceBySerial(admin(), 'CQZ7224');
      expect(mine).toMatchObject({
        type: 'biometricDevice',
        id: front.id,
        organizationId: A.org,
      });
      await expect(
        authorize(admin(), 'biometric:manage', mine!),
      ).resolves.toBeUndefined();
      await expect(authorize(lead(), 'biometric:manage', mine!)).rejects.toMatchObject({
        reason: 'out_of_scope',
      });
      expect(await loadDeviceBySerial(admin(), 'NO-SUCH')).toBeNull();
      expect(await loadDeviceBySerial(admin(), '../etc')).toBeNull();
    });

    it('configuration changes reach new punches only, and live mode waits for 5c', async () => {
      const change = await changeDevice(
        admin(),
        'CQZ7224',
        patchDeviceSchema.parse({
          clockOffsetSeconds: -300,
          readerDirection: 'entry',
          readers: [{ readerKey: '2', label: 'Exit turnstile', direction: 'exit' }],
          ipAllowlist: ['203.0.113.7', '198.51.100.0/24'],
          status: 'enabled',
        }),
      );
      expect(change).toMatchObject({
        lastSeenAt: null,
        device: {
          clockOffsetSeconds: -300,
          readerDirection: 'entry',
          status: 'enabled',
          dryRun: true,
          readers: [{ readerKey: '2', label: 'Exit turnstile', direction: 'exit' }],
          ipAllowlist: ['203.0.113.7', '198.51.100.0/24'],
        },
      });
      await expect(
        changeDevice(admin(), 'CQZ7224', patchDeviceSchema.parse({ dryRun: false })),
      ).rejects.toMatchObject({ status: 409, code: 'BIOMETRIC_LIVE_NOT_AVAILABLE' });
      await expect(
        changeDevice(
          admin(),
          'CQZ7224',
          patchDeviceSchema.parse({ readerDirection: 'both-trusted' }),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'BIOMETRIC_TRUSTED_KEYS_REQUIRED' });
      await expect(
        changeDevice(
          admin(),
          'CQZ7224',
          patchDeviceSchema.parse({ timezone: 'Mars/Olympus' }),
        ),
      ).rejects.toMatchObject({ code: 'BIOMETRIC_TIMEZONE_INVALID' });
      expect(() => patchDeviceSchema.parse({ ipAllowlist: ['300.1.1.1'] })).toThrow();
      expect(() => patchDeviceSchema.parse({})).toThrow();
    });
  });

  describe('PIN mappings', () => {
    const map = (body: Record<string, unknown>) =>
      putMapping(
        admin(),
        mappingSchema.parse({ connectorId: front.connectorId, ...body }),
        fixedClock('2026-09-26T12:00:00+05:30'),
      );

    it('maps a PIN from a date and counts the unmapped punches it now covers', async () => {
      await receivedPunch({
        device: front.id,
        pin: '0042',
        local: '2026-09-20T09:00:00',
        status: 'unmapped',
      });
      await receivedPunch({
        device: front.id,
        pin: '0042',
        local: '2026-08-20T09:00:00',
        status: 'unmapped',
      });
      const result = await map({
        pin: '0042',
        userId: A.alice,
        effectiveFrom: '2026-08-01',
      });
      expect(result).toMatchObject({
        mapping: { pin: '0042', userId: A.alice, deviceId: null, effectiveTo: null },
        warnings: [],
        needsReview: 0,
      });
      // The punch of 20 August was received now too, but only the last 30 days' receipts count.
      expect(result.replayable).toBe(2);
    });

    it('a PIN held in the scope is refused, naming the holder', async () => {
      await expect(
        map({ pin: '0042', userId: A.bob, effectiveFrom: '2026-09-28' }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'BIOMETRIC_PIN_HELD',
        details: { holders: [{ userId: A.alice, effectiveFrom: '2026-08-01' }] },
      });
    });

    it('ending the holder’s row hands the PIN over at midnight', async () => {
      await map({
        pin: '0042',
        userId: A.alice,
        effectiveFrom: '2026-08-01',
        effectiveTo: '2026-09-28',
      });
      const handed = await map({
        pin: '0042',
        userId: A.bob,
        effectiveFrom: '2026-09-28',
      });
      expect(
        handed.history.map((row) => [row.userId, row.effectiveFrom, row.effectiveTo]),
      ).toEqual([
        [A.alice, '2026-08-01', '2026-09-28'],
        [A.bob, '2026-09-28', null],
      ]);
    });

    it('a device row may override the connector row, with a warning', async () => {
      const result = await map({
        pin: '0042',
        deviceId: front.id,
        userId: A.alice,
        effectiveFrom: '2026-10-01',
      });
      expect(result.warnings).toEqual([
        {
          pin: '0042',
          deviceId: front.id,
          deviceRowUserId: A.alice,
          connectorRowUserId: A.bob,
        },
      ]);
    });

    it('never moves an applied punch: a mapping that would give it to someone else opens a review', async () => {
      const applied = await appliedPunch(
        front.id,
        '0077',
        '2026-09-10T09:00:00',
        A.alice,
      );
      const result = await map({
        pin: '0077',
        userId: A.bob,
        effectiveFrom: '2026-09-01',
      });
      expect(result.needsReview).toBe(1);
      const [punch] = await asOwner(
        'the punch stays',
        sql`SELECT user_id, status FROM biometric_punch WHERE id = ${applied}`,
      );
      expect(punch).toEqual({ userId: A.alice, status: 'applied' });
      const reviews = await asOwner(
        'its review',
        sql`SELECT kind FROM biometric_review_item WHERE punch_id = ${applied} AND resolved_at IS NULL`,
      );
      expect(reviews).toEqual([{ kind: 'mapping-changed' }]);
    });

    it('refuses ids from outside the tenant and an empty period', async () => {
      await expect(
        map({ pin: '0100', userId: B.alice, effectiveFrom: '2026-09-01' }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'BIOMETRIC_PERSON_NOT_FOUND',
      });
      await expect(
        putMapping(
          admin(),
          mappingSchema.parse({
            connectorId: randomUUID(),
            pin: '0100',
            userId: A.alice,
            effectiveFrom: '2026-09-01',
          }),
        ),
      ).rejects.toMatchObject({ status: 404, code: 'BIOMETRIC_CONNECTOR_NOT_FOUND' });
      await expect(
        map({
          pin: '0100',
          userId: A.alice,
          effectiveFrom: '2026-09-01',
          effectiveTo: '2026-09-01',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'BIOMETRIC_RANGE_INVALID' });
      await expect(
        putMapping(
          lead(),
          mappingSchema.parse({
            connectorId: front.connectorId,
            pin: '0100',
            userId: A.alice,
            effectiveFrom: '2026-09-01',
          }),
        ),
      ).rejects.toMatchObject({ reason: 'out_of_scope' });
    });
  });

  describe('the punch stream and replay', () => {
    it('pages newest first with a cursor that never skips or repeats', async () => {
      const base = Date.parse('2026-09-26T06:00:00Z');
      for (let i = 0; i < 5; i += 1)
        await receivedPunch({
          device: front.id,
          pin: '0500',
          local: `2026-09-26T09:0${i}:00`,
          status: 'held',
          receivedAt: new Date(base + i * 1000),
        });
      const seen: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await listPunches(admin(), {
          limit: 2,
          pin: '0500',
          ...(after ? { after } : {}),
        });
        seen.push(...result.punches.map((p) => p.deviceLocalTime ?? p.correctedAt));
        if (result.next === null) break;
        after = result.next;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      const [newest] = (await listPunches(admin(), { limit: 1, pin: '0500' })).punches;
      expect(newest).toMatchObject({
        status: 'held',
        serialNumber: 'CQZ7224',
        meaning: 'scan',
      });
      await expect(
        listPunches(admin(), { limit: 1, after: 'garbage' }),
      ).rejects.toMatchObject({
        status: 422,
      });
    });

    it('a replay selects waiting punches only, within a bounded range', async () => {
      await appliedPunch(front.id, '0600', '2026-09-15T09:00:00', A.alice);
      await receivedPunch({
        device: front.id,
        pin: '0600',
        local: '2026-09-15T18:00:00',
        status: 'unmapped',
      });
      await receivedPunch({
        device: front.id,
        pin: '0600',
        local: '2026-09-16T09:00:00',
        status: 'rejected',
        userId: A.alice,
      });
      const accepted = await requestReplay(
        admin(),
        replaySchema.parse({
          reason: 'PIN 0600 mapped late',
          pin: '0600',
          from: '2026-09-01',
          to: '2026-09-30',
        }),
      );
      expect(accepted.selected).toBe(2);
      const [request] = await asOwner(
        'the request',
        sql`SELECT status, selected_count, pin FROM biometric_replay_request WHERE id = ${accepted.requestId}`,
      );
      expect(request).toEqual({ status: 'pending', selectedCount: 2, pin: '0600' });
      // Its job is queued after commit, through the outbox.
      const signals = await asOwner(
        'the replay signal',
        sql`SELECT payload FROM domain_outbox
            WHERE organization_id = ${A.org} AND event_name = 'biometric.replay-requested'`,
      );
      expect(signals).toEqual([{ payload: { requestId: accepted.requestId } }]);

      await expect(
        requestReplay(
          admin(),
          replaySchema.parse({
            reason: 'none',
            pin: '9999',
            from: '2026-09-01',
            to: '2026-09-30',
          }),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'BIOMETRIC_NOTHING_TO_REPLAY' });
      await expect(
        requestReplay(
          admin(),
          replaySchema.parse({
            reason: 'too long',
            from: '2026-01-01',
            to: '2026-09-30',
          }),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'BIOMETRIC_RANGE_INVALID' });
      await expect(
        requestReplay(
          admin(),
          replaySchema.parse({
            reason: 'x',
            deviceId: randomUUID(),
            from: '2026-09-01',
            to: '2026-09-30',
          }),
        ),
      ).rejects.toMatchObject({ status: 404, code: 'BIOMETRIC_DEVICE_NOT_FOUND' });
    });
  });
});
