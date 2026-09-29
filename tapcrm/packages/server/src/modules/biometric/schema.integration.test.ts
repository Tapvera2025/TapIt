import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Migration 0058 against real PostgreSQL: tenant isolation, the composite keys,
 * dated PIN scopes, resend identity, the frozen reading and who owns a linked
 * punch (design §10.4, step 5 plan Task 1). No global directory is involved.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

interface Tenant {
  readonly org: string;
  readonly hr: string;
  readonly alice: string;
  readonly bob: string;
  readonly zk: string;
  readonly hik: string;
  readonly front: string;
  readonly gate: string; // on the hik connector
}
const tenant = (): Tenant => ({
  org: randomUUID(),
  hr: randomUUID(),
  alice: randomUUID(),
  bob: randomUUID(),
  zk: randomUUID(),
  hik: randomUUID(),
  front: randomUUID(),
  gate: randomUUID(),
});
const A = tenant();
const B = tenant();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = (org: string) =>
  createJobContext({
    organizationId: org,
    principal: systemPrincipal(org),
    jobName: 'test',
    runId: randomUUID(),
  });

async function seedTenant(t: Tenant, serial: string) {
  await asOwner(
    'organization',
    sql`INSERT INTO organization (id, code, name, timezone)
        VALUES (${t.org}, ${`BM${t.org.slice(0, 6)}`}, 'Biometric', 'Asia/Kolkata')`,
  );
  for (const [index, id] of [t.hr, t.alice, t.bob].entries()) {
    await asOwner(
      'person',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${id}, ${t.org}, 'service', ${`b${index}-${id}@t.io`}, ${`Person ${index}`})`,
    );
  }
  await asOwner(
    'connectors',
    sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
        VALUES (${t.zk}, ${t.org}, 'zk-adms', 'ZK fleet', ${t.hr}),
               (${t.hik}, ${t.org}, 'vendor-api', 'Gate terminal', ${t.hr})`,
  );
  await asOwner(
    'devices',
    sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone, created_by)
        VALUES (${t.front}, ${t.org}, ${t.zk}, ${serial}, 'Front door', 'Asia/Kolkata', ${t.hr}),
               (${t.gate}, ${t.org}, ${t.hik}, ${`${serial}-G`}, 'Gate', 'Asia/Kolkata', ${t.hr})`,
  );
}

async function clearTenant(t: Tenant) {
  // One statement: the punch and the event point at each other.
  await asOwner(
    'clear punches and events',
    sql`WITH punches AS (DELETE FROM biometric_punch WHERE organization_id = ${t.org})
        DELETE FROM attendance_event WHERE organization_id = ${t.org}`,
  );
  for (const table of [
    'biometric_pin_mapping',
    'biometric_reader',
    'biometric_device',
    'biometric_connector',
    'identity_email_directory',
    'app_user',
  ]) {
    await asOwner(
      `clear ${table}`,
      sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${t.org}`,
    );
  }
  await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${t.org}`);
}

interface PunchSeed {
  readonly id?: string;
  readonly org?: string;
  readonly device?: string;
  readonly pin?: string;
  readonly local?: string; // the device's clock reading, IST
  readonly userId?: string | null;
  readonly status?: string;
  readonly dryRun?: boolean;
}

/** The receipt insert the pipeline uses: a resend is a no-op. */
function receiptInsert(p: PunchSeed) {
  const local = p.local ?? '2026-09-22 09:00:00';
  const at = new Date(`${local.replace(' ', 'T')}+05:30`);
  return sql`
    INSERT INTO biometric_punch (id, organization_id, device_id, pin, device_local_time, occurred_at,
                                 corrected_at, applied_offset_seconds, raw_line, direction_at_receipt,
                                 meaning, dry_run_at_receipt, status, user_id)
    VALUES (${p.id ?? randomUUID()}, ${p.org ?? A.org}, ${p.device ?? A.front}, ${p.pin ?? '001'}, ${local},
            ${at}, ${at}, 0, ${`001\t${local}\t0\t1`}, 'entry', 'in', ${p.dryRun ?? false},
            ${p.status ?? 'received'}, ${p.userId === undefined ? A.alice : p.userId})
    ON CONFLICT DO NOTHING`;
}

async function seedPunch(p: PunchSeed = {}): Promise<string> {
  const id = p.id ?? randomUUID();
  await asOwner('receive a punch', receiptInsert({ ...p, id }));
  return id;
}

async function mapPin(
  t: Tenant,
  row: {
    device?: string | null;
    connector?: string;
    pin?: string;
    userId?: string;
    from: string;
    to?: string | null;
  },
) {
  return asOwner(
    'map a PIN',
    sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, device_id, pin, user_id, effective_from,
                                           effective_to, created_by)
        VALUES (${t.org}, ${row.connector ?? t.zk}, ${row.device ?? null}, ${row.pin ?? '001'},
                ${row.userId ?? t.alice}, ${row.from}, ${row.to ?? null}, ${t.hr})`,
  );
}

describe.skipIf(!enabled)('biometric schema (PostgreSQL)', () => {
  beforeAll(async () => {
    await seedTenant(A, 'SN-SHARED');
    await seedTenant(B, 'SN-SHARED'); // equal serials in two tenants: fine before G2
  });

  afterAll(async () => {
    await clearTenant(A);
    await clearTenant(B);
    await closePools();
  });

  describe('tenancy and keys', () => {
    it('a tenant sees and writes only its own rows', async () => {
      const seen = await db.query<{ id: string }>(
        ctx(A.org),
        sql`SELECT id FROM biometric_device ORDER BY serial_number`,
      );
      expect(seen.map((row) => row.id).sort()).toEqual([A.front, A.gate].sort());
      await expect(
        db.query(
          ctx(A.org),
          sql`INSERT INTO biometric_connector (organization_id, kind, name, created_by)
              VALUES (${B.org}, 'zk-adms', 'Stray', ${A.hr})`,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('a serial is unique within a tenant', async () => {
      await expect(
        asOwner(
          'a second SN-SHARED in A',
          sql`INSERT INTO biometric_device (organization_id, connector_id, serial_number, name, timezone, created_by)
              VALUES (${A.org}, ${A.zk}, 'SN-SHARED', 'Copy', 'Asia/Kolkata', ${A.hr})`,
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('refuses keys that reach into another tenant', async () => {
      await expect(mapPin(A, { connector: B.zk, from: '2026-01-01' })).rejects.toThrow(
        /foreign key/,
      );
      await expect(seedPunch({ device: B.front })).rejects.toThrow(/foreign key/);
      await expect(mapPin(A, { userId: B.alice, from: '2026-01-01' })).rejects.toThrow(
        /foreign key/,
      );
    });

    it('a device-specific mapping names a device of the same connector', async () => {
      await expect(
        mapPin(A, { connector: A.zk, device: A.gate, from: '2026-01-01' }),
      ).rejects.toThrow(/foreign key/);
    });

    it('a new device starts pending and in dry-run; both-trusted needs trusted keys', async () => {
      const [row] = await asOwner(
        'read the device',
        sql`SELECT status, dry_run FROM biometric_device WHERE id = ${A.front}`,
      );
      expect(row).toEqual({ status: 'pending', dryRun: true });
      await expect(
        asOwner(
          'both-trusted without keys',
          sql`UPDATE biometric_device SET reader_direction = 'both-trusted' WHERE id = ${A.front}`,
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  describe('PIN scopes and periods', () => {
    it('one holder per PIN, scope and day; end-exclusive periods may touch', async () => {
      await mapPin(A, {
        pin: '0100',
        userId: A.alice,
        from: '2026-01-01',
        to: '2026-09-28',
      });
      await mapPin(A, { pin: '0100', userId: A.bob, from: '2026-09-28' }); // midnight hand-over
      await expect(
        mapPin(A, { pin: '0100', userId: A.bob, from: '2026-09-27', to: '2026-09-29' }),
      ).rejects.toThrow(/biometric_pin_mapping_organization_id_connector_id/);
    });

    it('a device row may override the connector row; another connector is another scope', async () => {
      await mapPin(A, { pin: '0200', from: '2026-01-01' });
      await mapPin(A, {
        pin: '0200',
        device: A.front,
        userId: A.bob,
        from: '2026-01-01',
      });
      await mapPin(A, {
        pin: '0200',
        connector: A.hik,
        userId: A.bob,
        from: '2026-01-01',
      });
      await expect(
        mapPin(A, { pin: '0200', device: A.front, from: '2026-06-01' }),
      ).rejects.toThrow(/conflicting key value/);
    });

    it('refuses an empty period, and keeps leading zeros apart', async () => {
      await expect(
        mapPin(A, { pin: '0300', from: '2026-09-22', to: '2026-09-22' }),
      ).rejects.toThrow(/check constraint/);
      await mapPin(A, { pin: '0300', from: '2026-01-01' });
      await mapPin(A, { pin: '300', from: '2026-01-01' });
    });
  });

  describe('receipts', () => {
    it('a resend keeps the first reading; concurrent inserts of one punch store one row', async () => {
      const deliveries = Array.from({ length: 4 }, () =>
        db.transaction(ctx(A.org), (tx) =>
          tx.query(receiptInsert({ pin: '0400', local: '2026-09-22 09:15:00' })),
        ),
      );
      await Promise.all(deliveries);
      const rows = await asOwner(
        'count the receipts',
        sql`SELECT count(*)::int AS count FROM biometric_punch
            WHERE organization_id = ${A.org} AND pin = '0400'`,
      );
      expect(rows).toEqual([{ count: 1 }]);
    });

    it('two readers firing in one second are two receipts', async () => {
      for (const readerKey of ['1', '2'])
        await asOwner(
          'a reader fires',
          sql`INSERT INTO biometric_punch (organization_id, device_id, pin, device_local_time, occurred_at, corrected_at,
                                           applied_offset_seconds, raw_line, direction_at_receipt, meaning,
                                           dry_run_at_receipt, reader_key)
              VALUES (${A.org}, ${A.front}, '0500', '2026-09-22 09:20:00', '2026-09-22T03:50:00Z', '2026-09-22T03:50:00Z',
                      0, 'line', 'undirected', 'scan', false, ${readerKey})`,
        );
    });

    it('the reading and the source are fixed; processing fields move, and roll back', async () => {
      const id = await seedPunch({ pin: '0600' });
      await expect(
        db.query(
          ctx(A.org),
          sql`UPDATE biometric_punch SET corrected_at = corrected_at + interval '1 minute' WHERE id = ${id}`,
        ),
      ).rejects.toThrow(/fixed at arrival/);
      await expect(
        db.query(
          ctx(A.org),
          sql`UPDATE biometric_punch SET meaning = 'out' WHERE id = ${id}`,
        ),
      ).rejects.toThrow(/fixed at arrival|check constraint/);
      await expect(
        db.transaction(ctx(A.org), async (tx) => {
          await tx.query(
            sql`UPDATE biometric_punch SET status = 'held', status_reason = 'backdated' WHERE id = ${id}`,
          );
          throw new Error('the processing transaction failed');
        }),
      ).rejects.toThrow('the processing transaction failed');
      await db.query(
        ctx(A.org),
        sql`UPDATE biometric_punch SET status = 'rejected', status_reason = 'future',
                                     processed_at = now() WHERE id = ${id}`,
      );
      const [row] = await asOwner(
        'read the punch',
        sql`SELECT status, status_reason FROM biometric_punch WHERE id = ${id}`,
      );
      expect(row).toEqual({ status: 'rejected', statusReason: 'future' });
      await expect(
        db.query(ctx(A.org), sql`DELETE FROM biometric_punch WHERE id = ${id}`),
      ).rejects.toThrow(/permission denied/);
    });

    it('an unmapped punch has no person, and gains one when resolved', async () => {
      await expect(seedPunch({ pin: '0700', status: 'unmapped' })).rejects.toThrow(
        /check constraint/,
      );
      const id = await seedPunch({ pin: '0700', status: 'unmapped', userId: null });
      await db.query(
        ctx(A.org),
        sql`UPDATE biometric_punch SET status = 'received', user_id = ${A.alice} WHERE id = ${id}`,
      );
    });
  });

  describe('bursts and attendance links', () => {
    it('a duplicate names a head of the same person', async () => {
      const head = await seedPunch({ pin: '0800', userId: A.alice });
      const other = await seedPunch({ pin: '0801', userId: A.bob });
      await expect(
        db.query(
          ctx(A.org),
          sql`UPDATE biometric_punch SET status = 'duplicate', duplicate_of = ${head} WHERE id = ${other}`,
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it('a dry-run punch never becomes attendance', async () => {
      const id = await seedPunch({ pin: '0900', dryRun: true });
      const [event] = await asOwner(
        'an event naming the punch',
        sql`INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
            VALUES (${A.org}, ${A.alice}, 'in', '2026-09-22T03:30:00Z', 'device', 'confirmed', ${id})
            RETURNING id`,
      );
      await expect(
        asOwner(
          'link it',
          sql`UPDATE biometric_punch SET status = 'applied', attendance_event_id = ${(event as { id: string }).id}
              WHERE id = ${id}`,
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        seedPunch({ pin: '0901', status: 'dry-run', dryRun: false }),
      ).rejects.toThrow(/check constraint/);
    });

    it('an applied punch keeps its event and its person, even with the pointer cleared first', async () => {
      const id = await seedPunch({ pin: '1000' });
      const [event] = (await asOwner(
        'its event',
        sql`INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
            VALUES (${A.org}, ${A.alice}, 'in', '2026-09-22T03:31:00Z', 'device', 'confirmed', ${id})
            RETURNING id`,
      )) as { id: string }[];
      await db.query(
        ctx(A.org),
        sql`UPDATE biometric_punch SET status = 'applied', attendance_event_id = ${event!.id} WHERE id = ${id}`,
      );
      await expect(
        db.query(
          ctx(A.org),
          sql`UPDATE biometric_punch SET attendance_event_id = NULL, status = 'received' WHERE id = ${id}`,
        ),
      ).rejects.toThrow(/keeps its event/);
      await expect(
        db.query(
          ctx(A.org),
          sql`UPDATE biometric_punch SET user_id = ${A.bob} WHERE id = ${id}`,
        ),
      ).rejects.toThrow(/keeps its event|foreign key/);
      // The event's own key: a device event belongs to its punch's person.
      await expect(
        asOwner(
          'an event for another person',
          sql`INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
              VALUES (${A.org}, ${A.bob}, 'in', '2026-09-22T03:32:00Z', 'device', 'confirmed', ${id})`,
        ),
      ).rejects.toThrow(/foreign key|ux_attendance_event_device_punch/);
    });
  });
});
