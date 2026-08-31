#!/usr/bin/env tsx
/**
 * Migration runner — TECH.md DP-1, IX-3.
 *
 *   "Migrations are FORWARD-ONLY, recorded, reviewed, and run before the new
 *    application version serves traffic."
 *   "Indexes are created only through versioned migrations. NO ORM AUTO-SYNC."
 *
 * There is deliberately no `down`. A down migration is a plan for undoing a
 * schema change against production data, and the honest version of that plan is
 * a restore plus a forward fix.
 *
 * Runs as the MIGRATION role (PG-3), never the application role.
 *
 *   npm run migrate          apply pending
 *   npm run migrate:status   list applied and pending
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');

interface Migration {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    // Lexicographic order over zero-padded numeric prefixes is deterministic,
    // which is the guardrail "migration order is deterministic and forward-only".
    .sort()
    .map((filename) => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8');
      const version = filename.replace(/\.sql$/, '');
      return {
        version,
        filename,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function connectionString(): string {
  const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Migrations run as the admin role, never as ' +
        'the application role (PG-3). See .env.example.',
    );
  }
  return url;
}

async function ensureBookkeeping(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum   text NOT NULL
    )
  `);
}

async function applied(client: pg.Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

async function up(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();

  try {
    await ensureBookkeeping(client);
    const already = await applied(client);
    const migrations = loadMigrations();

    // An applied migration whose file has changed means someone edited history.
    // Forward-only means the file is immutable once applied.
    for (const migration of migrations) {
      const priorChecksum = already.get(migration.version);
      if (priorChecksum !== undefined && priorChecksum !== migration.checksum) {
        throw new Error(
          `${migration.filename} has changed since it was applied.\n` +
            'Migrations are forward-only and immutable once applied (DP-1). ' +
            'Write a new migration instead of editing this one.',
        );
      }
    }

    const pending = migrations.filter((m) => !already.has(m.version));
    if (pending.length === 0) {
      console.log('✓ No pending migrations');
      return;
    }

    for (const migration of pending) {
      process.stdout.write(`  ${migration.filename} ... `);
      // Each migration is one transaction: it applies completely or not at all.
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [migration.version, migration.checksum],
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (error) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw error;
      }
    }

    console.log(`\n✓ Applied ${pending.length} migration(s)`);
  } finally {
    await client.end();
  }
}

async function status(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    await ensureBookkeeping(client);
    const already = await applied(client);
    for (const migration of loadMigrations()) {
      const mark = already.has(migration.version) ? '✓ applied' : '· pending';
      console.log(`  ${mark}  ${migration.filename}`);
    }
  } finally {
    await client.end();
  }
}

const command = process.argv[2] ?? 'up';
const run = command === 'status' ? status : up;

run().catch((error: unknown) => {
  console.error('\n✗ Migration failed');

  console.error('error:', error);
  console.error('message:', error instanceof Error ? error.message : String(error));

  if (error instanceof Error) {
    console.error('name:', error.name);
    console.error('stack:', error.stack);
  }

  const pgError = error as {
    code?: string;
    detail?: string;
    hint?: string;
    severity?: string;
    routine?: string;
  };

  console.error('code:', pgError.code);
  console.error('detail:', pgError.detail);
  console.error('hint:', pgError.hint);
  console.error('severity:', pgError.severity);
  console.error('routine:', pgError.routine);

  process.exit(1);
});
