import { getPool } from '../packages/server/src/platform/dal/pool.js';

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const orgs = await client.query('SELECT * FROM organization');
    console.log('Organizations:', orgs.rows);

    const users = await client.query('SELECT id, organization_id, full_name, email, account_type, status FROM app_user');
    console.log('Users:', users.rows);

    const depts = await client.query('SELECT * FROM department');
    console.log('Departments:', depts.rows);

    const positions = await client.query('SELECT id, organization_id, department_id, code, name, organizational_level, is_seeded, status FROM position');
    console.log('Positions:', positions.rows);

    const teams = await client.query('SELECT * FROM team');
    console.log('Teams:', teams.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
