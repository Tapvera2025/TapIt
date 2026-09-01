import { getPool } from '../packages/server/src/platform/dal/pool.js';
import { hashPassword } from '../packages/server/src/modules/identity/password.js';

async function seed() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check or create organization 'tapvera'
    const orgRes = await client.query("SELECT id FROM organization WHERE code = 'tapvera'");
    let orgId: string;
    if (orgRes.rows.length === 0) {
      const inserted = await client.query(
        "INSERT INTO organization (code, name, timezone, currency, status) VALUES ('tapvera', 'Tapvera Technologies', 'Asia/Kolkata', 'INR', 'active') RETURNING id",
      );
      orgId = inserted.rows[0].id;
    } else {
      orgId = orgRes.rows[0].id;
    }
    console.log('Organization ID:', orgId);

    // Set tenant context for RLS
    await client.query(`SELECT set_config('app.organization_id', $1, true)`, [orgId]);

    // 2. Create Super Admin user
    const passwordHash = await hashPassword('admin@123456');
    const adminRes = await client.query(
      `SELECT id FROM app_user WHERE organization_id = $1 AND email = 'admin@tapvera.io'`,
      [orgId],
    );

    let adminId: string;
    if (adminRes.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO app_user (
          organization_id,
          full_name,
          email,
          account_type,
          status,
          password_hash,
          email_verified_at,
          session_version
        ) VALUES (
          $1,
          'Tapvera Super Admin',
          'admin@tapvera.io',
          'super-admin',
          'active',
          $2,
          now(),
          1
        ) RETURNING id`,
        [orgId, passwordHash],
      );
      adminId = ins.rows[0].id;
      console.log('Created Super Admin:', adminId);
    } else {
      adminId = adminRes.rows[0].id;
      await client.query(
        `UPDATE app_user SET password_hash = $1, status = 'active', email_verified_at = now() WHERE id = $2`,
        [passwordHash, adminId],
      );
      console.log('Updated Super Admin password for:', adminId);
    }

    // 3. Create Default Departments (Sales, Development, HR, Finance)
    const depts = [
      { code: 'sales', name: 'Sales & Revenue', kind: 'delivery' },
      { code: 'development', name: 'Software Engineering', kind: 'delivery' },
      { code: 'hr', name: 'Human Resources', kind: 'support' },
      { code: 'finance', name: 'Finance & Operations', kind: 'support' },
    ];

    const deptMap = new Map<string, string>();
    for (const d of depts) {
      const existing = await client.query(
        'SELECT id FROM department WHERE organization_id = $1 AND code = $2',
        [orgId, d.code],
      );
      if (existing.rows.length === 0) {
        const ins = await client.query(
          `INSERT INTO department (organization_id, code, name, kind, status)
           VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
          [orgId, d.code, d.name, d.kind],
        );
        deptMap.set(d.code, ins.rows[0].id);
      } else {
        deptMap.set(d.code, existing.rows[0].id);
      }
    }
    console.log('Departments seeded:', Array.from(deptMap.keys()));

    // 4. Create Standard Position Ladders
    const salesDeptId = deptMap.get('sales')!;
    const devDeptId = deptMap.get('development')!;
    const hrDeptId = deptMap.get('hr')!;

    // Sales Root Position (Level 100)
    const salesHeadRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'head-of-sales'`,
      [orgId],
    );
    let headOfSalesId: string;
    if (salesHeadRes.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level,
          is_seeded, status, max_deal_value, max_discount_percent, allows_custom_terms
        ) VALUES (
          $1, $2, 'head-of-sales', 'Head of Sales', 100,
          true, 'active', 50000000.00, 40.00, true
        ) RETURNING id`,
        [orgId, salesDeptId],
      );
      headOfSalesId = ins.rows[0].id;
    } else {
      headOfSalesId = salesHeadRes.rows[0].id;
    }

    // Sales Team Lead (Level 60)
    const salesLeadRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'sales-team-lead'`,
      [orgId],
    );
    let salesTeamLeadId: string;
    if (salesLeadRes.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level, parent_position_id,
          is_seeded, status, max_deal_value, max_discount_percent, allows_custom_terms
        ) VALUES (
          $1, $2, 'sales-team-lead', 'Sales Team Lead', 60, $3,
          true, 'active', 10000000.00, 25.00, true
        ) RETURNING id`,
        [orgId, salesDeptId, headOfSalesId],
      );
      salesTeamLeadId = ins.rows[0].id;
    } else {
      salesTeamLeadId = salesLeadRes.rows[0].id;
    }

    // Account Executive (Level 25)
    const aeRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'account-executive'`,
      [orgId],
    );
    if (aeRes.rows.length === 0) {
      await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level, parent_position_id,
          is_seeded, status, max_deal_value, max_discount_percent, allows_custom_terms
        ) VALUES (
          $1, $2, 'account-executive', 'Account Executive', 25, $3,
          true, 'active', 2000000.00, 10.00, false
        )`,
        [orgId, salesDeptId, salesTeamLeadId],
      );
    }

    // Development Root Position (Level 100)
    const devHeadRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'head-of-development'`,
      [orgId],
    );
    let headOfDevId: string;
    if (devHeadRes.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level,
          is_seeded, status
        ) VALUES (
          $1, $2, 'head-of-development', 'Head of Engineering', 100,
          true, 'active'
        ) RETURNING id`,
        [orgId, devDeptId],
      );
      headOfDevId = ins.rows[0].id;
    } else {
      headOfDevId = devHeadRes.rows[0].id;
    }

    // Dev Team Manager (Level 60)
    const devMgrRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'developer-team-manager'`,
      [orgId],
    );
    if (devMgrRes.rows.length === 0) {
      await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level, parent_position_id,
          is_seeded, status
        ) VALUES (
          $1, $2, 'developer-team-manager', 'Engineering Manager', 60, $3,
          true, 'active'
        )`,
        [orgId, devDeptId, headOfDevId],
      );
    }

    // HR Manager Root Position (Level 100)
    const hrHeadRes = await client.query(
      `SELECT id FROM position WHERE organization_id = $1 AND code = 'head-of-hr'`,
      [orgId],
    );
    if (hrHeadRes.rows.length === 0) {
      await client.query(
        `INSERT INTO position (
          organization_id, department_id, code, name, organizational_level,
          is_seeded, status
        ) VALUES (
          $1, $2, 'head-of-hr', 'Head of People & HR', 100,
          true, 'active'
        )`,
        [orgId, hrDeptId],
      );
    }

    // 5. Seed Designations
    const desigs = [
      { name: 'Senior Software Engineer', specializations: ['React', 'TypeScript', 'Node.js'] },
      { name: 'Enterprise Account Executive', specializations: ['B2B Sales', 'Negotiation', 'SaaS'] },
      { name: 'People Operations Specialist', specializations: ['Onboarding', 'Payroll', 'Compliance'] },
    ];

    for (const d of desigs) {
      const existing = await client.query(
        'SELECT id FROM designation WHERE organization_id = $1 AND name = $2',
        [orgId, d.name],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO designation (organization_id, name, specializations) VALUES ($1, $2, $3)`,
          [orgId, d.name, d.specializations],
        );
      }
    }

    // 6. Seed Position Default Policies for seeded positions
    const posRows = await client.query('SELECT id, code FROM position WHERE organization_id = $1', [orgId]);
    for (const pos of posRows.rows) {
      const defaultAction = pos.code.includes('sales') ? 'deals:view' : 'tasks:view';
      const existingPolicy = await client.query(
        'SELECT id FROM position_policy WHERE organization_id = $1 AND position_id = $2 AND action = $3',
        [orgId, pos.id, defaultAction],
      );
      if (existingPolicy.rows.length === 0) {
        await client.query(
          `INSERT INTO position_policy (
            organization_id, position_id, action, allowed, scope
          ) VALUES (
            $1, $2, $3, true, 'department'
          )`,
          [orgId, pos.id, defaultAction],
        );
      }
    }

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
