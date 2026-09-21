#!/usr/bin/env tsx
/**
 * Sets the runtime role's password from the environment.
 *
 *   npm run migrate && npm run db:app-password
 *
 * Migration 0033 removes the password that 0008 hard-coded; this puts the real
 * one in, so a credential lives in the secret store / .env and never in a
 * migration. Idempotent: it is safe to run on every deploy, and it is also how a
 * password is rotated. Runs as the migration/admin role (PG-3).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const RETIRED_PASSWORDS = new Set(['app_dev_password']);
const MIN_LENGTH = 16;

const url = process.env['MIGRATION_DATABASE_URL'];
const password = process.env['POSTGRES_APP_PASSWORD'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
if (!password) throw new Error('POSTGRES_APP_PASSWORD is required. Set it in .env.');
if (password.length < MIN_LENGTH)
  throw new Error(`POSTGRES_APP_PASSWORD must be at least ${MIN_LENGTH} characters`);
if (RETIRED_PASSWORDS.has(password))
  throw new Error('POSTGRES_APP_PASSWORD is a value that was published in the repository');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // ALTER ROLE cannot take a bind parameter, so the literal is escaped by the driver.
  await client.query(`ALTER ROLE tapcrm_app WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  console.log('✓ Runtime role password set from POSTGRES_APP_PASSWORD');
} finally {
  await client.end();
}
