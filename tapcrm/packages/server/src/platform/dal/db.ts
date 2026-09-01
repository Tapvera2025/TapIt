import { AsyncLocalStorage } from 'node:async_hooks';
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
import { GLOBAL_TABLES, tenantTablesNamedIn } from './tenant-tables.js';

/**
 * The Data Access Layer — TECH.md §4.2.
 *
 *   "No module imports a database driver pool directly. All access goes through
 *    the DAL, which takes the request context and establishes database tenant
 *    context."
 *
 * Three surfaces, deliberately three separate objects rather than one object
 * with a flag, so that reaching for a wider one is a visible act:
 *
 *   db          tenant        every product module, and every background job
 *   identityDb  pre-auth      authentication only, before a principal exists
 *   platformDb  cross-tenant  platform administration, over GLOBAL tables only
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The failure mode this file is shaped around
 *
 * Every tenant table has RLS enabled and forced, with a policy of
 * `organization_id = current_organization_id()`. When no tenant context is set
 * that function returns NULL, the comparison is NULL, and the policy matches
 * nothing.
 *
 * PostgreSQL does not consider that an error. `UPDATE … WHERE id = 'x'` against
 * rows you cannot see returns `UPDATE 0` and the caller carries on. A whole
 * module can be written this way and pass every manual test, because the reads
 * that would reveal the problem are equally blind.
 *
 * So two rules run through everything below:
 *
 *   1. There is no way to reach a tenant table without naming an organization.
 *      `platformDb` refuses tenant tables outright; `identityDb` and `db` both
 *      set context before the first statement.
 *   2. A write can be asked to prove it did something. `mustExecute` throws
 *      when a statement affects no rows, which turns a silent no-op into a loud
 *      failure at the moment it happens rather than a mystery months later.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface Tx {
  query<T>(fragment: SqlFragment): Promise<T[]>;
  one<T>(fragment: SqlFragment): Promise<T>;
  maybeOne<T>(fragment: SqlFragment): Promise<T | null>;
  /** Runs a write and returns the number of rows it affected. */
  execute(fragment: SqlFragment): Promise<number>;
  /**
   * Runs a write that is expected to change something, and throws when it does
   * not. `what` names the thing, for the error message.
   */
  mustExecute(fragment: SqlFragment, what: string): Promise<number>;
}

export interface Db {
  query<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T[]>;
  one<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T>;
  maybeOne<T>(ctx: RequestContext, fragment: SqlFragment): Promise<T | null>;
  execute(ctx: RequestContext, fragment: SqlFragment): Promise<number>;
  mustExecute(ctx: RequestContext, fragment: SqlFragment, what: string): Promise<number>;
  transaction<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Thrown when a statement that was supposed to change something changed
 * nothing.
 *
 * Usually one of three things: the row does not exist, it belongs to another
 * tenant, or the guard clause in the WHERE (`revoked_at IS NULL`, `used_at IS
 * NULL`) was already satisfied by a concurrent request. All three are
 * conditions the caller must handle explicitly; none of them are "carry on".
 */
export class EmptyWriteError extends Error {
  readonly what: string;

  constructor(what: string) {
    super(
      `Expected to modify ${what}, but the statement affected no rows. ` +
        'Either the row does not exist, it is outside this tenant, or another ' +
        'request already changed it.',
    );
    this.name = 'EmptyWriteError';
    this.what = what;
  }
}

/**
 * Raised when a cross-tenant surface is pointed at a tenant-owned table.
 *
 * MT-5: "Feature code cannot perform cross-tenant reads." Without this the
 * statement would run, match nothing, and look like it worked.
 */
export class TenantSurfaceViolationError extends Error {
  constructor(operation: string, tables: readonly string[]) {
    super(
      `platformDb operation "${operation}" names tenant-owned table(s): ${tables.join(', ')}. ` +
        'A cross-tenant surface cannot reach tenant data — without tenant context an RLS ' +
        'policy matches no rows, so the statement would succeed and do nothing. Use `db` with ' +
        'a RequestContext, or `identityDb` for pre-authentication work.',
    );
    this.name = 'TenantSurfaceViolationError';
  }
}

/* ==================================================================== *
 * Per-request connection scope
 * ==================================================================== */

interface ConnectionScope {
  readonly organizationId: string;
  /**
   * Acquired on FIRST database use, not when the scope opens. A request that
   * never touches the database — a health check, a 304, a cached response —
   * must not hold a pooled connection for its lifetime. With a bounded pool
   * (DP-8) and the §17 concurrency targets, eagerly checking one out per
   * request is how a pool that is correctly sized on paper exhausts in
   * practice.
   */
  lease: Lease | null;
  /** Savepoint depth, so a nested unit of work does not BEGIN twice. */
  depth: number;
}

const scopeStore = new AsyncLocalStorage<ConnectionScope>();

/**
 * A checked-out connection and whether it has been handed back.
 *
 * `pg` throws on a second `release()`, and that throw usually happens inside a
 * `finally`, where it replaces the real error with a confusing one. So release
 * is guarded — but the guard has to be per CHECKOUT, not per client object.
 * `pg.Pool` hands back the same client instance over and over, so a flag keyed
 * on the instance would mark it released forever after the first use and every
 * later checkout would silently leak. That is a pool exhaustion that only shows
 * up under load, as a five-second connection timeout with no other symptom.
 */
interface Lease {
  readonly client: PgPoolClient;
  released: boolean;
}

async function acquire(): Promise<Lease> {
  return { client: await getPool().connect(), released: false };
}

function release(lease: Lease, error?: Error): void {
  if (lease.released) return;
  lease.released = true;
  if (error) lease.client.release(error);
  else lease.client.release();
}

/**
 * Binds one pooled connection to everything that runs inside `fn`.
 *
 * Without this, every `db.query` checks a connection out of the pool and hands
 * it straight back — so a request doing ten reads churns ten checkouts.
 * Authorization alone costs three of them (permission set, subordinate closure,
 * team closure), which is most of the 20 ms p95 budget in NF-5 spent on pool
 * bookkeeping rather than on work.
 *
 * The CONNECTION is bound, not the transaction: each unit of work still opens
 * and closes its own short transaction on it (TX-3), and tenant context is
 * still set transaction-locally (TN-6), so nothing leaks to the next borrower.
 */
export async function withConnectionScope<T>(
  organizationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new MissingTenantContextError('connection scope opened with no organizationId');
  }
  if (scopeStore.getStore() !== undefined) {
    // Already inside a scope — reuse it rather than opening a second one.
    return fn();
  }

  const scope: ConnectionScope = { organizationId, lease: null, depth: 0 };
  try {
    return await scopeStore.run(scope, fn);
  } finally {
    if (scope.lease !== null) release(scope.lease);
  }
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
 */
const SET_TENANT = `SELECT set_config('app.organization_id', $1, true)`;

/**
 * Runs one unit of work inside a transaction with tenant context established.
 *
 * BEGIN and the context statement are written to the wire together rather than
 * awaited one at a time. `pg` serialises statements on a connection, so
 * ordering is still guaranteed; only the waiting is removed.
 */
async function inTenantTransaction<T>(
  organizationId: string,
  fn: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new MissingTenantContextError('unit of work started with no organizationId');
  }

  const scope = scopeStore.getStore();

  if (scope !== undefined) {
    if (scope.organizationId !== organizationId) {
      // MT-6 — a request scoped to one organization may never reach another.
      throw new MissingTenantContextError(
        `connection scope belongs to organization ${scope.organizationId}, ` +
          `but this unit of work is for ${organizationId}`,
      );
    }
    scope.lease ??= await acquire();
    return runOnLease(scope.lease, organizationId, fn, scope);
  }

  const lease = await acquire();
  try {
    return await runOnLease(lease, organizationId, fn, null);
  } finally {
    release(lease);
  }
}

async function runOnLease<T>(
  lease: Lease,
  organizationId: string,
  fn: (client: PgPoolClient) => Promise<T>,
  scope: ConnectionScope | null,
): Promise<T> {
  const client = lease.client;
  // A nested unit of work on an already-open transaction gets a savepoint
  // rather than a second BEGIN, which PostgreSQL would warn about and ignore —
  // leaving the inner "transaction" silently unable to roll back on its own.
  const nested = scope !== null && scope.depth > 0;
  const savepoint = nested ? `sp_${String(scope.depth)}` : null;

  if (scope !== null) scope.depth += 1;

  try {
    if (savepoint === null) {
      const begun = client.query('BEGIN');
      const contexted = client.query(SET_TENANT, [organizationId]);
      await Promise.all([begun, contexted]);
    } else {
      await client.query(`SAVEPOINT ${savepoint}`);
    }

    const result = await fn(client);

    await client.query(savepoint === null ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      await client.query(
        savepoint === null ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`,
      );
    } catch {
      // A failed rollback means the connection is unusable. Release it with the
      // error so the pool discards it rather than handing it to the next
      // caller mid-transaction.
      release(lease, error instanceof Error ? error : new Error(String(error)));
      if (scope !== null) scope.lease = null;
    }
    throw error;
  } finally {
    if (scope !== null) scope.depth -= 1;
  }
}

/* ==================================================================== *
 * Retry — TECH.md §9.7.1
 * ==================================================================== */

/**
 * "The DAL owns the bounded retry policy. MODULES NEVER IMPLEMENT THEIR OWN
 * RETRY LOOPS." CI-31 enforces that.
 *
 * 40001 (serialization_failure) and 40P01 (deadlock_detected) are retryable at
 * the transaction level. Everything else is not.
 */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 25;

async function withRetry<T>(fn: () => Promise<T>, idempotencyKey: string | null): Promise<T> {
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
 * The transaction handle
 * ==================================================================== */

function makeTx(client: PgPoolClient): Tx {
  const run = (fragment: SqlFragment) => client.query(fragment.sql, [...fragment.parameters]);

  const tx: Tx = {
    async query<T>(fragment: SqlFragment): Promise<T[]> {
      const result = await run(fragment);
      // §5.1 — the query layer performs the mapping. Every row leaves the DAL
      // in camelCase, so the field names AUTHORIZATION.md declares (initiator
      // fields, participant fields) are the field names the engine reads.
      return camelizeRows<T>(result.rows as Record<string, unknown>[]);
    },

    async one<T>(fragment: SqlFragment): Promise<T> {
      const rows = await tx.query<T>(fragment);
      const row = rows[0];
      if (row === undefined || rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${String(rows.length)}`);
      }
      return row;
    },

    async maybeOne<T>(fragment: SqlFragment): Promise<T | null> {
      const rows = await tx.query<T>(fragment);
      if (rows.length > 1) {
        throw new Error(`Expected at most one row, got ${String(rows.length)}`);
      }
      return rows[0] ?? null;
    },

    async execute(fragment: SqlFragment): Promise<number> {
      const result = await run(fragment);
      return result.rowCount ?? 0;
    },

    async mustExecute(fragment: SqlFragment, what: string): Promise<number> {
      const affected = await tx.execute(fragment);
      if (affected === 0) throw new EmptyWriteError(what);
      return affected;
    },
  };

  return tx;
}

/* ==================================================================== *
 * db — the tenant surface
 * ==================================================================== */

function tenantUnit<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRetry(
    () => inTenantTransaction(ctx.organizationId, (client) => fn(makeTx(client))),
    null,
  );
}

export const db: Db = {
  query: (ctx, fragment) => tenantUnit(ctx, (tx) => tx.query(fragment)),
  one: (ctx, fragment) => tenantUnit(ctx, (tx) => tx.one(fragment)),
  maybeOne: (ctx, fragment) => tenantUnit(ctx, (tx) => tx.maybeOne(fragment)),
  execute: (ctx, fragment) => tenantUnit(ctx, (tx) => tx.execute(fragment)),
  mustExecute: (ctx, fragment, what) => tenantUnit(ctx, (tx) => tx.mustExecute(fragment, what)),
  transaction: (ctx, fn) => tenantUnit(ctx, fn),
};

/* ==================================================================== *
 * identityDb — the pre-authentication surface
 * ==================================================================== */

/**
 * The one surface for work that happens BEFORE a principal exists.
 *
 * Authentication has a chicken-and-egg problem: resolving the principal
 * requires reading `app_user`, but `db` requires a `RequestContext`, and the
 * context cannot be built without the principal.
 *
 * That is a reason to run without a *principal*. It is NOT a reason to run
 * without a *tenant* — the organization is always known at this point, because
 * it arrived on the credential the caller presented: the organization code on a
 * login form, the `org` claim on an access token, the prefix of a refresh
 * token, the row a single-use token belongs to. So every method here takes it,
 * sets it as tenant context, and lets RLS adjudicate exactly as it does for an
 * authenticated request. A caller who names an organization that does not
 * contain the row gets nothing back.
 *
 * Confined to `modules/identity` by a CI check, so "we needed a read before the
 * context existed" cannot quietly become a general-purpose escape.
 */
export interface IdentityDb {
  read<T>(organizationId: string, fragment: SqlFragment): Promise<T[]>;
  readOne<T>(organizationId: string, fragment: SqlFragment): Promise<T | null>;
  execute(organizationId: string, fragment: SqlFragment): Promise<number>;
  mustExecute(organizationId: string, fragment: SqlFragment, what: string): Promise<number>;
  transaction<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

function identityUnit<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRetry(
    () => inTenantTransaction(organizationId, (client) => fn(makeTx(client))),
    null,
  );
}

export const identityDb: IdentityDb = {
  read: (organizationId, fragment) => identityUnit(organizationId, (tx) => tx.query(fragment)),
  readOne: (organizationId, fragment) =>
    identityUnit(organizationId, (tx) => tx.maybeOne(fragment)),
  execute: (organizationId, fragment) =>
    identityUnit(organizationId, (tx) => tx.execute(fragment)),
  mustExecute: (organizationId, fragment, what) =>
    identityUnit(organizationId, (tx) => tx.mustExecute(fragment, what)),
  transaction: (organizationId, fn) => identityUnit(organizationId, fn),
};

/* ==================================================================== *
 * platformDb — cross-tenant, global tables only
 * ==================================================================== */

/**
 * MT-5 — "FEATURE CODE CANNOT PERFORM CROSS-TENANT READS. The tenant DAL always
 * enforces organizationId; allow-listed platformDb operations may operate
 * across organizations only when explicitly required, are separately
 * credentialed where applicable, and are AUDITED."
 *
 * "Allow-listed" is enforced here rather than assumed. Every call names its
 * operation, its reason and the tables it touches, and any tenant-owned table
 * in that list — or anywhere in the statement text — is refused.
 *
 * A job that genuinely needs to work across organizations does not reach tenant
 * data through this surface. It lists organization ids here, then constructs a
 * `RequestContext` per organization and uses `db` (TN-9, JB-3). That keeps the
 * tenant predicate on every statement that touches tenant data, which is the
 * whole point of MT-3.
 */
export type PlatformOperation =
  | 'migration'
  | 'seed'
  | 'organization-lookup'
  | 'organization-provisioning'
  | 'organization-enumeration'
  | 'health-check';

export interface PlatformCall {
  readonly operation: PlatformOperation;
  readonly reason: string;
  /** Every table the statement names. Checked against the tenant list. */
  readonly tables: readonly string[];
}

function nonGlobal(call: PlatformCall): readonly string[] {
  return call.tables.filter((table) => !GLOBAL_TABLES.has(table));
}

function assertGlobalOnly(call: PlatformCall, sql: string): void {
  const declared = nonGlobal(call);
  if (declared.length > 0) {
    throw new TenantSurfaceViolationError(call.operation, declared);
  }
  // Belt and braces: the declaration says global, but check the statement too.
  // A declaration is a promise; this is the verification.
  const named = tenantTablesNamedIn(sql);
  if (named.length > 0) {
    throw new TenantSurfaceViolationError(call.operation, named);
  }
}

function platformPool(operation: PlatformOperation) {
  return operation === 'migration' || operation === 'seed' ? getMigrationPool() : getPool();
}

function logPlatformCall(call: PlatformCall): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'platformDb cross-tenant operation',
      operation: call.operation,
      reason: call.reason,
      tables: call.tables,
    }),
  );
}

/** Applies the same statement scan to every fragment run inside a platform transaction. */
function guardedTx(tx: Tx, call: PlatformCall): Tx {
  const guard = (fragment: SqlFragment): SqlFragment => {
    const named = tenantTablesNamedIn(fragment.sql);
    if (named.length > 0) throw new TenantSurfaceViolationError(call.operation, named);
    return fragment;
  };
  return {
    query: (f) => tx.query(guard(f)),
    one: (f) => tx.one(guard(f)),
    maybeOne: (f) => tx.maybeOne(guard(f)),
    execute: (f) => tx.execute(guard(f)),
    mustExecute: (f, what) => tx.mustExecute(guard(f), what),
  };
}

export const platformDb = {
  async query<T>(call: PlatformCall, fragment: SqlFragment): Promise<T[]> {
    assertGlobalOnly(call, fragment.sql);
    logPlatformCall(call);
    const result = await platformPool(call.operation).query(fragment.sql, [
      ...fragment.parameters,
    ]);
    return camelizeRows<T>(result.rows as Record<string, unknown>[]);
  },

  async transaction<T>(call: PlatformCall, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const declared = nonGlobal(call);
    if (declared.length > 0) {
      throw new TenantSurfaceViolationError(call.operation, declared);
    }
    logPlatformCall(call);
    const client = await platformPool(call.operation).connect();
    try {
      await client.query('BEGIN');
      const result = await fn(guardedTx(makeTx(client), call));
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
export const globalDb = {
  async query<T>(table: string, fragment: SqlFragment): Promise<T[]> {
    if (!GLOBAL_TABLES.has(table)) {
      throw new Error(
        `TN-3: "${table}" is not an allow-listed global table. Tenant-owned data must go ` +
          'through `db`, which injects organization context. Adding a global table requires review.',
      );
    }
    const named = tenantTablesNamedIn(fragment.sql);
    if (named.length > 0) {
      throw new TenantSurfaceViolationError('global-read', named);
    }
    const result = await getPool().query(fragment.sql, [...fragment.parameters]);
    return camelizeRows<T>(result.rows as Record<string, unknown>[]);
  },
};
