import type { SqlFragment } from '@tapcrm/authz';
import { getPool, getMigrationPool, type PgPoolClient } from './pool.js';
import type { RequestContext } from './context.js';
import { MissingTenantContextError } from './context.js';
import { camelizeRows } from './mapping.js';
import {
  classifyDatabaseError,
  RetryExhaustedError,
  AmbiguousCommitError,
} from './errors.js';

/**
 * The Data Access Layer — TECH.md §4.2.
 *
 *   "No module imports a database driver pool directly. All access goes through
 *    the DAL, which takes the request context and establishes database tenant
 *    context."
 *
 * Three surfaces (§4.2.2), deliberately three separate objects rather than one
 * object with a flag, so that reaching for the privileged one is a visible act:
 *
 *   db          tenant      every product module
 *   globalDb    global      reference-data code only
 *   platformDb  privileged  platform administration, retention, seeding
 */

export interface Tx {
  query<T>(fragment: SqlFragment): Promise<T[]>;
  one<T>(fragment: SqlFragment): Promise<T>;
  maybeOne<T>(fragment: SqlFragment): Promise<T | null>;
}

export interface Db {
  query<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T[]>;
  one<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T>;
  maybeOne<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T | null>;
  transaction<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/* ==================================================================== *
 * Tenant context
 * ==================================================================== */

/**
 * TN-6 — "Every tenant-bound database unit of work starts with a
 * transaction-local setting such as `SELECT set_config('app.organization_id',
 * $1, true)`. The setting is NEVER PERSISTED on a pooled connection."
 *
 * The `true` third argument is what makes it transaction-local. Without it the
 * setting survives on the pooled connection and the next request — possibly for
 * a different tenant — inherits it. That is the single most dangerous mistake
 * available in this file.
 *
 * A guardrail in tools/ci/check-tenancy.ts asserts no `set_config('app.` call
 * exists outside this module.
 */
const SET_TENANT = `SELECT set_config('app.organization_id', $1, true)`;

async function withTenantTransaction<T>(
  ctx: RequestContext,
  fn: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  if (!ctx.organizationId) {
    throw new MissingTenantContextError('RequestContext has no organizationId');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(SET_TENANT, [ctx.organizationId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A failed rollback means the connection is already broken. Releasing it
      // with an error below removes it from the pool rather than reusing it.
      client.release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    throw error;
  } finally {
    // `release()` is safe to call twice; the error path above already handled
    // the broken-connection case.
    client.release();
  }
}


async function withOrganizationTransaction<T>(
  organizationId: string,
  fn: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new MissingTenantContextError('organizationId is required');
  }

  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    await client.query(SET_TENANT, [organizationId]);

    const result = await fn(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      client.release(error instanceof Error ? error : new Error(String(error)));

      throw error;
    }

    throw error;
  } finally {
    client.release();
  }
}
/* ==================================================================== *
 * Retry — TECH.md §9.7.1
 * ==================================================================== */

/**
 * "The DAL owns the bounded retry policy. MODULES NEVER IMPLEMENT THEIR OWN
 * RETRY LOOPS." CI-31 enforces that: transaction creation and retry appear only
 * in platform/DAL.
 *
 * 40001 (serialization_failure) and 40P01 (deadlock_detected) are retryable at
 * the transaction level. Everything else is not.
 */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 25;

async function withRetry<T>(
  fn: () => Promise<T>,
  idempotencyKey: string | null,
): Promise<T> {
  let lastClassified = classifyDatabaseError(new Error('no attempt made'));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const classified = classifyDatabaseError(error);
      lastClassified = classified;

      // §9.7.1 — connection lost around COMMIT. The outcome may be ambiguous:
      // the transaction may have committed before the connection dropped.
      // NEVER blindly repeat a non-idempotent mutation.
      if (classified.failureClass === 'connection_failure') {
        throw new AmbiguousCommitError(idempotencyKey);
      }

      if (!classified.retryable || attempt === MAX_ATTEMPTS) {
        if (classified.retryable) break;
        throw error;
      }

      // Exponential backoff with jitter, so N contending workers do not all
      // retry in lockstep and reproduce the contention that failed them.
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // "Retry budget exhausted under contention → 503 + Retry-After. Back off; the
  // system is SATURATED, not logically invalid." Never a 409.
  throw new RetryExhaustedError(MAX_ATTEMPTS, lastClassified);
}

/* ==================================================================== *
 * db — the tenant surface
 * ==================================================================== */

function makeTx(client: PgPoolClient): Tx {
  return {
    async query<T>(fragment: SqlFragment): Promise<T[]> {
      const result = await client.query(fragment.sql, [...fragment.parameters]);
      // §5.1 — the query layer performs the mapping. Every row leaves the DAL
      // in camelCase, so the field names AUTHORIZATION.md declares (initiator
      // fields, participant fields) are the field names the engine reads.
      return camelizeRows<T>(result.rows as Record<string, unknown>[]);
    },
    async one<T>(fragment: SqlFragment): Promise<T> {
      const rows = await this.query<T>(fragment);
      const row = rows[0];
      if (row === undefined || rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${rows.length}`);
      }
      return row;
    },
    async maybeOne<T>(fragment: SqlFragment): Promise<T | null> {
      const rows = await this.query<T>(fragment);
      if (rows.length > 1)
        throw new Error(`Expected at most one row, got ${rows.length}`);
      return rows[0] ?? null;
    },
  };
}

export const db: Db = {
  async query<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T[]> {
    return withRetry(
      () =>
        withTenantTransaction(ctx, async (client) =>
          makeTx(client).query<T>(fragment),
        ),
      null,
    );
  },

  async one<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T> {
    return withRetry(
      () =>
        withTenantTransaction(ctx, async (client) =>
          makeTx(client).one<T>(fragment),
        ),
      null,
    );
  },

  async maybeOne<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T | null> {
    return withRetry(
      () =>
        withTenantTransaction(ctx, async (client) =>
          makeTx(client).maybeOne<T>(fragment),
        ),
      null,
    );
  },

  async transaction<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRetry(
      () =>
        withTenantTransaction(ctx, async (client) => fn(makeTx(client))),
      null,
    );
  },
};

/* ==================================================================== *
 * bootstrapDb — the pre-context read
 * ==================================================================== */

/**
 * The one read that happens BEFORE a RequestContext exists.
 *
 * Authentication has a chicken-and-egg problem: resolving the principal
 * requires reading `app_user`, but `db` requires a RequestContext, and the
 * context cannot be built without the principal. Pipeline step 1 sits outside
 * the tenant DAL by necessity.
 *
 * It is NOT a hole. The organization id comes from the caller's credential and
 * is set as tenant context for the read, so RLS still adjudicates: if the
 * claimed organization does not actually contain that user, the query matches
 * zero rows and authentication fails. A caller cannot name someone else's
 * tenant and get a principal back.
 *
 * Named explicitly, and confined to identity, so that "we needed a read before
 * the context existed" can never quietly become a general-purpose escape.
 */
export const bootstrapDb = {
  async readAs<T>(organizationId: string, fragment: SqlFragment): Promise<T[]> {
    if (!organizationId) {
      throw new MissingTenantContextError('bootstrap read with no organizationId');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(SET_TENANT, [organizationId]);
      const result = await client.query(fragment.sql, [...fragment.parameters]);
      await client.query('COMMIT');
      return camelizeRows<T>(result.rows as Record<string, unknown>[]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

/* ==================================================================== *
 * globalDb — allow-listed global reference tables
 * ==================================================================== */

/**
 * TN-3 — "Genuinely global reference data — country codes, currency codes and
 * similar immutable reference data — lives in explicitly global tables. Adding
 * a new global table REQUIRES REVIEW."
 *
 * The allow-list is that review, expressed in code. A query naming a table not
 * on it is refused rather than silently running without a tenant predicate.
 */
const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  'country',
  'currency',
  'schema_migrations',
]);

export const globalDb = {
  async query<T>(table: string, fragment: SqlFragment): Promise<T[]> {
    if (!GLOBAL_TABLES.has(table)) {
      throw new Error(
        `TN-3: "${table}" is not an allow-listed global table. Tenant-owned data must go ` +
          'through `db`, which injects organization context. Adding a global table requires review.',
      );
    }
    const result = await getPool().query(fragment.sql, [...fragment.parameters]);
    return result.rows as T[];
  },
};

export const identityDb = {
  async transactionForOrganization<T>(
    organizationId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!organizationId) {
      throw new MissingTenantContextError('identity transaction with no organizationId');
    }

    return withRetry(
      () =>
        withOrganizationTransaction(organizationId, async (client) => fn(makeTx(client))),
      null,
    );
  },
};
/* ==================================================================== *
 * platformDb — privileged, cross-tenant
 * ==================================================================== */

/**
 * MT-5 — "FEATURE CODE CANNOT PERFORM CROSS-TENANT READS. The tenant DAL always
 * enforces organizationId; allow-listed platformDb operations may operate
 * across organizations only when explicitly required, are separately
 * credentialed where applicable, and are AUDITED."
 *
 * Every call therefore takes a named `operation` and a `reason`, both of which
 * are logged. An unnamed cross-tenant query is not possible through this API.
 */
export type PlatformOperation =
  | 'migration'
  | 'seed'
  | 'retention-enforcement'
  | 'audit-chain-verification'
  | 'audit-archiving'
  | 'organization-provisioning'
  | 'health-check';

export const platformDb = {
  async query<T>(
    operation: PlatformOperation,
    reason: string,
    fragment: SqlFragment,
  ): Promise<T[]> {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'platformDb cross-tenant operation',
        operation,
        reason,
      }),
    );
    const pool =
      operation === 'migration' || operation === 'seed' ? getMigrationPool() : getPool();
    const result = await pool.query(fragment.sql, [...fragment.parameters]);
    return result.rows as T[];
  },

  async transaction<T>(
    operation: PlatformOperation,
    reason: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'platformDb cross-tenant transaction',
        operation,
        reason,
      }),
    );
    const pool =
      operation === 'migration' || operation === 'seed' ? getMigrationPool() : getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(makeTx(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};
