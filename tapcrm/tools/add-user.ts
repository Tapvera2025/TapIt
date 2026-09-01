// #!/usr/bin/env tsx
// /**
//  * Add User Tool
//  *
//  * Usage:
//  *   npm run add-user
//  *
//  * Environment variables:
//  *   USER_EMAIL=user@example.com
//  *   USER_PASSWORD=password123456
//  *   USER_FULL_NAME="John Doe"
//  *   USER_ACCOUNT_TYPE=employee|client|super-admin
//  *   ORG_CODE=tapvera (defaults to 'tapvera')
//  */

// import pg from 'pg';
// import argon2 from 'argon2';
// import * as readline from 'node:readline/promises';
// import { stdin as input, stdout as output } from 'node:process';

// async function main(): Promise<void> {
//   const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
//   if (!url) {
//     throw new Error('DATABASE_URL is not set');
//   }

//   const rl = readline.createInterface({ input, output });

//   try {
//     // Get organization code
//     const orgCode =
//       process.env['ORG_CODE'] ??
//       (await rl.question('Organization code (default: tapvera): ')) ||
//       'tapvera';

//     // Get user details
//     const email =
//       process.env['USER_EMAIL'] ?? (await rl.question('Email address: '));

//     if (!email) {
//       throw new Error('Email is required');
//     }

//     const fullName =
//       process.env['USER_FULL_NAME'] ?? (await rl.question('Full name: '));

//     if (!fullName) {
//       throw new Error('Full name is required');
//     }

//     const accountType =
//       process.env['USER_ACCOUNT_TYPE'] ??
//       (await rl.question('Account type (super-admin/employee/client): ')) ||
//       'employee';

//     if (!['super-admin', 'employee', 'client'].includes(accountType)) {
//       throw new Error('Invalid account type. Must be: super-admin, employee, or client');
//     }

//     const password =
//       process.env['USER_PASSWORD'] ?? (await rl.question('Password (min 12 characters): '));

//     if (!password || password.length < 12) {
//       throw new Error('Password must be at least 12 characters long (ID-3 policy)');
//     }

//     const passwordHash = await argon2.hash(password, {
//       type: argon2.argon2id,
//       memoryCost: 65536,
//       timeCost: 3,
//       parallelism: 4,
//     });

//     const client = new pg.Client({ connectionString: url });
//     await client.connect();

//     try {
//       // Get organization ID
//       const orgResult = await client.query<{ id: string }>(
//         'SELECT id FROM organization WHERE code = $1 AND status = $2',
//         [orgCode, 'active'],
//       );

//       if (orgResult.rows.length === 0) {
//         throw new Error(`Organization with code "${orgCode}" not found`);
//       }

//       const organizationId = orgResult.rows[0]!.id;

//       // Set tenant context
//       await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);

//       // For employees, we need position_id and department_id
//       let positionId: string | null = null;
//       let departmentId: string | null = null;

//       if (accountType === 'employee') {
//         const positionResult = await client.query<{ id: string; department_id: string }>(
//           `SELECT p.id, p.department_id
//            FROM position p
//            WHERE p.organization_id = $1
//              AND p.status = 'active'
//            ORDER BY p.code
//            LIMIT 1`,
//           [organizationId],
//         );

//         if (positionResult.rows.length === 0) {
//           throw new Error('No active positions found. Please create positions first or use account type "super-admin".');
//         }

//         positionId = positionResult.rows[0]!.id;
//         departmentId = positionResult.rows[0]!.department_id;

//         console.log(`  Using position ID: ${positionId}`);
//         console.log(`  Using department ID: ${departmentId}`);
//       }

//       // For clients, verify or create client record
//       let clientId: string | null = null;
//       if (accountType === 'client') {
//         const clientRes = await client.query<{ id: string }>(
//           `SELECT id FROM client WHERE organization_id = $1 LIMIT 1`,
//           [organizationId],
//         );
//         if (clientRes.rows.length > 0) {
//           clientId = clientRes.rows[0]!.id;
//         } else {
//           throw new Error('Client account type requires an existing client record in the database.');
//         }
//       }

//       // Insert user with email_verified_at set (ID-12)
//       const userResult = await client.query<{ id: string }>(
//         `INSERT INTO app_user
//           (organization_id, account_type, email, password_hash, full_name, status, mfa_required,
//            position_id, department_id, client_id, email_verified_at, session_version)
//          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 1)
//          RETURNING id`,
//         [
//           organizationId,
//           accountType,
//           email,
//           passwordHash,
//           fullName,
//           'active',
//           accountType === 'super-admin', // Super Admin requires MFA by default (ID-4)
//           positionId,
//           departmentId,
//           clientId,
//         ],
//       );

//       const userId = userResult.rows[0]!.id;

//       console.log('\n✓ User created successfully!');
//       console.log(`  ID: ${userId}`);
//       console.log(`  Organization: ${orgCode}`);
//       console.log(`  Account Type: ${accountType}`);
//       console.log(`  Email: ${email}`);
//       console.log(`  Full Name: ${fullName}`);
//       console.log(`  Password: ${password}`);
//       console.log('\nLogin credentials:');
//       console.log(`  Organization Code: ${orgCode}`);
//       console.log(`  Account Type: ${accountType === 'super-admin' ? 'Super Admin' : accountType === 'employee' ? 'Employee' : 'Client'}`);
//       console.log(`  Email: ${email}`);
//       console.log(`  Password: ${password}`);
//     } finally {
//       await client.end();
//     }
//   } finally {
//     rl.close();
//   }
// }

// main().catch((error: unknown) => {
//   console.error('\n✗ Failed to create user');
//   console.error(error instanceof Error ? error.message : String(error));
//   process.exit(1);
// });




import pg from 'pg';
import argon2 from 'argon2';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main(): Promise<void> {
  const url =
    process.env['MIGRATION_DATABASE_URL'] ??
    process.env['DATABASE_URL'];

  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  const rl = readline.createInterface({ input, output });

  try {
    // Get organization code
    const orgCode =
      (process.env['ORG_CODE'] ??
        (await rl.question('Organization code (default: tapvera): '))) ||
      'tapvera';

    // Get user details
    const email =
      process.env['USER_EMAIL'] ??
      (await rl.question('Email address: '));

    if (!email) {
      throw new Error('Email is required');
    }

    const fullName =
      process.env['USER_FULL_NAME'] ??
      (await rl.question('Full name: '));

    if (!fullName) {
      throw new Error('Full name is required');
    }

    const accountType =
      (process.env['USER_ACCOUNT_TYPE'] ??
        (await rl.question(
          'Account type (super-admin/employee/client): ',
        ))) || 'employee';

    if (
      !['super-admin', 'employee', 'client'].includes(accountType)
    ) {
      throw new Error(
        'Invalid account type. Must be: super-admin, employee, or client',
      );
    }

    const password =
      process.env['USER_PASSWORD'] ??
      (await rl.question('Password (min 12 characters): '));

    if (!password || password.length < 12) {
      throw new Error(
        'Password must be at least 12 characters long (ID-3 policy)',
      );
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const client = new pg.Client({
      connectionString: url,
    });

    await client.connect();

    try {
      // Get organization ID
      const orgResult = await client.query<{ id: string }>(
        `SELECT id
         FROM organization
         WHERE code = $1
           AND status = $2`,
        [orgCode, 'active'],
      );

      if (orgResult.rows.length === 0) {
        throw new Error(
          `Organization with code "${orgCode}" not found`,
        );
      }

      const organizationId = orgResult.rows[0]!.id;

      // Set tenant context
      await client.query(
        'SELECT set_config($1, $2, true)',
        ['app.organization_id', organizationId],
      );

      // For employees, we need position_id and department_id
      let positionId: string | null = null;
      let departmentId: string | null = null;

      if (accountType === 'employee') {
        const positionResult = await client.query<{
          id: string;
          department_id: string;
        }>(
          `SELECT p.id, p.department_id
           FROM position p
           WHERE p.organization_id = $1
             AND p.status = 'active'
           ORDER BY p.code
           LIMIT 1`,
          [organizationId],
        );

        if (positionResult.rows.length === 0) {
          throw new Error(
            'No active positions found. Please create positions first or use account type "super-admin".',
          );
        }

        positionId = positionResult.rows[0]!.id;
        departmentId = positionResult.rows[0]!.department_id;

        console.log(`  Using position ID: ${positionId}`);
        console.log(`  Using department ID: ${departmentId}`);
      }

      // For clients, verify or create client record
      let clientId: string | null = null;

      if (accountType === 'client') {
        const clientRes = await client.query<{ id: string }>(
          `SELECT id
           FROM client
           WHERE organization_id = $1
           LIMIT 1`,
          [organizationId],
        );

        if (clientRes.rows.length > 0) {
          clientId = clientRes.rows[0]!.id;
        } else {
          throw new Error(
            'Client account type requires an existing client record in the database.',
          );
        }
      }

      // Insert user with email_verified_at set (ID-12)
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO app_user
          (
            organization_id,
            account_type,
            email,
            password_hash,
            full_name,
            status,
            mfa_required,
            position_id,
            department_id,
            client_id,
            email_verified_at,
            session_version
          )
         VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            NOW(),
            1
          )
         RETURNING id`,
        [
          organizationId,
          accountType,
          email,
          passwordHash,
          fullName,
          'active',
          accountType === 'super-admin',
          positionId,
          departmentId,
          clientId,
        ],
      );

      const userId = userResult.rows[0]!.id;

      console.log('\n✓ User created successfully!');
      console.log(`  ID: ${userId}`);
      console.log(`  Organization: ${orgCode}`);
      console.log(`  Account Type: ${accountType}`);
      console.log(`  Email: ${email}`);
      console.log(`  Full Name: ${fullName}`);
      console.log(`  Password: ${password}`);

      console.log('\nLogin credentials:');
      console.log(`  Organization Code: ${orgCode}`);
      console.log(
        `  Account Type: ${
          accountType === 'super-admin'
            ? 'Super Admin'
            : accountType === 'employee'
              ? 'Employee'
              : 'Client'
        }`,
      );
      console.log(`  Email: ${email}`);
      console.log(`  Password: ${password}`);
    } finally {
      await client.end();
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error('\n✗ Failed to create user');
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});

