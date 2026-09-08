#!/usr/bin/env tsx
import pg from 'pg';
import argon2 from 'argon2';

const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const email = process.env['PLATFORM_ADMIN_EMAIL'];
const password = process.env['PLATFORM_ADMIN_PASSWORD'];
const name = process.env['PLATFORM_ADMIN_NAME'] ?? 'Tapvera Master Admin';
if (!email || !password)
  throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required');
if (password.length < 12)
  throw new Error('Platform admin password must be at least 12 characters');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await client.query(
    `INSERT INTO platform_user(email, full_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id,email`,
    [email.toLowerCase(), name, hash],
  );
  console.log(
    `✓ Platform Master Admin ready: ${result.rows[0].email} (${result.rows[0].id})`,
  );
} finally {
  await client.end();
}
