#!/usr/bin/env tsx
/**
 * Bootstraps the Tapvera Master Admin.
 *
 *   npm run platform:admin                create the account if it does not exist
 *   npm run platform:admin:reset          deliberately replace its password
 *
 * The default mode NEVER modifies an existing account. It used to upsert, which
 * meant every `docker compose up` silently reverted the password to whatever the
 * environment held, and forced `status = 'active'` on an account an operator had
 * locked or disabled. A password change must be a deliberate act.
 */
import pg from 'pg';
import argon2 from 'argon2';

const RESET = process.argv.includes('--reset-password');

// The password compose used to fall back to. Refused so it cannot survive as a
// configured value.
const RETIRED_DEFAULT_PASSWORD = 'master_admin_dev_password';

const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const email = process.env['PLATFORM_ADMIN_EMAIL']?.trim().toLowerCase();
const password = process.env['PLATFORM_ADMIN_PASSWORD'];
const name = process.env['PLATFORM_ADMIN_NAME'] ?? 'Tapvera Master Admin';
if (!email || !password)
  throw new Error(
    'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required. Set them in .env.',
  );
if (password.length < 12)
  throw new Error('Platform admin password must be at least 12 characters');
if (password === RETIRED_DEFAULT_PASSWORD)
  throw new Error('PLATFORM_ADMIN_PASSWORD is the retired development default; choose another');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM platform_user WHERE email = $1',
    [email],
  );

  if (existing.rowCount === 0) {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const created = await client.query<{ id: string; email: string }>(
      `INSERT INTO platform_user(email, full_name, password_hash, email_verified_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, email`,
      [email, name, hash],
    );
    console.log(`✓ Platform Master Admin created: ${created.rows[0]!.email} (${created.rows[0]!.id})`);
  } else if (!RESET) {
    console.log(
      `✓ Platform Master Admin ${email} already exists; left unchanged. ` +
        'Use `npm run platform:admin:reset` to replace its password.',
    );
  } else {
    const id = existing.rows[0]!.id;
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await client.query('BEGIN');
    try {
      // Bumping session_version and revoking sessions is what makes a reset
      // actually end access held under the old password. Status is left alone:
      // resetting a password must not un-lock or re-enable the account.
      await client.query(
        `UPDATE platform_user
         SET password_hash = $2, session_version = session_version + 1
         WHERE id = $1`,
        [id, hash],
      );
      await client.query(
        `UPDATE platform_session SET revoked_at = now()
         WHERE platform_user_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`✓ Platform Master Admin ${email}: password replaced and all sessions revoked.`);
  }
} finally {
  await client.end();
}
