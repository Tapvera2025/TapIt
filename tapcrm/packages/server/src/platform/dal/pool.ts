import pg from 'pg';
import { loadConfig } from '../../config.js';

/**
 * The connection pool.
 *
 * CI-15 — "No module imports the raw PostgreSQL pool or creates its own
 * database connection." THIS FILE IS THE ONLY EXCEPTION, and the CI check
 * allow-lists it by path. Everything else goes through `db`, `globalDb` or
 * `platformDb` in `./db.ts`.
 *
 * PG-5 — pg returns NUMERIC as a string by default in newer versions, but the
 * parser is registered explicitly below because relying on a driver default for
 * monetary correctness is exactly the kind of assumption that produces an
 * invoice that does not reconcile.
 */

const { Pool, types } = pg;

/* NUMERIC (OID 1700) → string, never a JavaScript float. PG-5. */
types.setTypeParser(1700, (value: string) => value);
/* INT8 (OID 20) → string. Sequence and audit `sequence` values exceed 2^53. */
types.setTypeParser(20, (value: string) => value);

export type PgPool = pg.Pool;
export type PgPoolClient = pg.PoolClient;

let appPool: PgPool | null = null;
let migrationPool: PgPool | null = null;

function create(connectionString: string, max: number, statementTimeoutMs: number): PgPool {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // A statement that runs longer than this is killed by the database rather
    // than holding a pooled connection hostage (§9.8 statement_timeout → 503).
    statement_timeout: statementTimeoutMs,
    // TX-3 — transactions are short. A transaction left open by a bug should
    // not survive; it holds locks that block the invoice-numbering path.
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'tapcrm',
  });

  pool.on('error', (error) => {
    // An idle client erroring is not attached to a request. Log and let the
    // pool replace it; never crash the process over it.
    console.error(JSON.stringify({ level: 'error', msg: 'pg idle client error', err: error.message }));
  });

  return pool;
}

/**
 * The APPLICATION pool. Uses the runtime role, which:
 *   - has no BYPASSRLS (PG-3)
 *   - owns no tables (PG-3)
 *   - has no UPDATE or DELETE on append-only tables (§4.4)
 */
export function getPool(): PgPool {
  if (appPool === null) {
    const config = loadConfig();
    appPool = create(
      config.DATABASE_URL,
      config.DATABASE_POOL_MAX,
      config.DATABASE_STATEMENT_TIMEOUT_MS,
    );
  }
  return appPool;
}

/**
 * The MIGRATION/ADMIN pool. Owns the tables. Never used by the request path —
 * §4.2.1: "Migration/admin roles are separate and are never used by the request
 * path."
 *
 * Kept in a separate pool rather than a separate connection string on the same
 * pool so that a request handler cannot reach it by accident.
 */
export function getMigrationPool(): PgPool {
  if (migrationPool === null) {
    const config = loadConfig();
    const url = config.MIGRATION_DATABASE_URL;
    if (url === undefined) {
      throw new Error(
        'MIGRATION_DATABASE_URL is not set. Migrations and seeds run as the admin role, ' +
          'never as the application role (PG-3).',
      );
    }
    migrationPool = create(url, 4, 300_000);
  }
  return migrationPool;
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool?.end(), migrationPool?.end()]);
  appPool = null;
  migrationPool = null;
}
