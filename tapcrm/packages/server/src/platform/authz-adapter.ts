import type {
  Action,
  PermissionPolicy,
  PermissionSet,
  Scope,
  UserId,
  TeamId,
  DepartmentId,
} from '@tapcrm/contracts';
import {
  configureAuthz,
  MEMO_KEYS,
  SUBORDINATES_CTE,
  TEAM_DESCENDANTS_CTE,
  POOL_MEMBERS,
  type AuthzAuditPort,
  type AuthzContext,
  type PolicyStorePort,
  type Resource,
  type ScopeResolverPort,
} from '@tapcrm/authz';
import { db } from './dal/db.js';
import { sql } from './dal/sql.js';
import type { RequestContext } from './dal/context.js';

/**
 * Wires the authorization engine to PostgreSQL.
 *
 * The engine defines ports; this implements them. That direction matters: the
 * engine is called on every request by every module (TECH.md §3), and making it
 * depend on the DAL would invert the layering and make the whole pipeline
 * untestable without a database.
 */

/** Memoises per request. NF-5 budgets the whole authorization step at 20 ms p95. */
async function memoised<T>(ctx: AuthzContext, key: string, load: () => Promise<T>): Promise<T> {
  const cached = ctx.memo.get(key);
  if (cached !== undefined) return cached as T;
  const value = await load();
  ctx.memo.set(key, value);
  return value;
}

const asRequestContext = (ctx: AuthzContext): RequestContext => ctx as RequestContext;

/* ==================================================================== *
 * Scope resolution — TECH.md §6.5
 * ==================================================================== */

export const scopeResolver: ScopeResolverPort = {
  async subordinateIds(ctx: AuthzContext): Promise<ReadonlySet<UserId>> {
    return memoised(ctx, MEMO_KEYS.subordinates, async () => {
      // BD-32: recursive CTE at launch. Target under 5 ms p95 on the reference
      // dataset, measured rather than assumed. A closure table is adopted only
      // on evidence — "do not pre-optimise a security-critical path into a
      // cache that can be wrong."
      const rows = await db.query<{ id: string }>(asRequestContext(ctx), {
        sql: SUBORDINATES_CTE,
        parameters: [ctx.organizationId, ctx.principal.id],
      });
      const ids = new Set(rows.map((r) => r.id));
      // VIS-1 is transitive and includes the principal themselves, which the
      // CTE's base case already provides.
      return ids;
    });
  },

  async teamIds(ctx: AuthzContext): Promise<ReadonlySet<TeamId>> {
    return memoised(ctx, MEMO_KEYS.teams, async () => {
      const teamId =
        ctx.principal.accountType === 'employee' ? ctx.principal.teamId : null;
      if (teamId === null) return new Set<TeamId>();

      const rows = await db.query<{ id: string }>(asRequestContext(ctx), {
        sql: TEAM_DESCENDANTS_CTE,
        parameters: [ctx.organizationId, teamId],
      });
      return new Set(rows.map((r) => r.id));
    });
  },

  async poolIds(ctx: AuthzContext): Promise<ReadonlySet<TeamId>> {
    return memoised(ctx, MEMO_KEYS.pools, async () => {
      if (ctx.principal.accountType !== 'employee' || ctx.principal.teamId === null) {
        return new Set<TeamId>();
      }
      // VIS-4: a Supervisor sees ONLY their own pool. No descent, no siblings.
      return new Set<TeamId>([ctx.principal.teamId]);
    });
  },

  async poolMemberIds(ctx: AuthzContext): Promise<ReadonlySet<UserId>> {
    return memoised(ctx, MEMO_KEYS.poolMembers, async () => {
      const pools = [...(await scopeResolver.poolIds(ctx))];
      if (pools.length === 0) return new Set<UserId>();

      const rows = await db.query<{ id: string }>(asRequestContext(ctx), {
        sql: POOL_MEMBERS,
        parameters: [ctx.organizationId, pools],
      });
      return new Set(rows.map((r) => r.id));
    });
  },

  async departmentId(ctx: AuthzContext): Promise<DepartmentId | null> {
    return memoised(ctx, MEMO_KEYS.department, async () =>
      ctx.principal.accountType === 'employee' ? ctx.principal.departmentId : null,
    );
  },
};

/* ==================================================================== *
 * Policy resolution — TECH.md §6.4
 * ==================================================================== */

interface PolicyRow {
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
  source: 'position' | 'override';
  expires_at: Date | null;
}

export const policyStore: PolicyStorePort = {
  async resolveSet(ctx: AuthzContext): Promise<PermissionSet> {
    return memoised(ctx, MEMO_KEYS.permissionSet, async () => {
      const now = new Date();

      // A client principal holds a fixed policy set, not a position (§7.1
      // `acct`). A service account never consults position policies at all
      // (SV-1) and is handled before this point in the pipeline.
      if (ctx.principal.accountType !== 'employee') {
        return { policies: {}, cacheDeadline: now, resolvedAt: now } satisfies PermissionSet;
      }

      const rows = await db.query<PolicyRow>(asRequestContext(ctx), {
        // AZ-I6 / OV-1: expiry is evaluated HERE, at resolution time. A row
        // whose expires_at has passed is excluded by the query itself, so an
        // override expiring at 10:00 stops applying at 10:00 — not whenever the
        // nightly job next runs.
        sql: `
          SELECT p.action, p.allowed, p.scope, p.fields, p.constraints,
                 'position'::text AS source, NULL::timestamptz AS expires_at
          FROM position_policy p
          WHERE p.organization_id = $1
            AND p.position_id = $2

          UNION ALL

          SELECT o.action, o.allowed, o.scope, o.fields, o.constraints,
                 'override'::text AS source, o.expires_at
          FROM user_override o
          WHERE o.organization_id = $1
            AND o.user_id = $3
            AND o.revoked_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())
        `,
        parameters: [ctx.organizationId, ctx.principal.positionId, ctx.principal.id],
      });

      const policies: Partial<Record<Action, PermissionPolicy>> = {};
      let earliestExpiry: Date | null = null;

      for (const row of rows) {
        // §4.4: "An override REPLACES the position's policy for that action."
        // The UNION returns both; the override wins regardless of row order.
        const existing = policies[row.action as Action];
        if (existing !== undefined && existing.source === 'override') continue;

        policies[row.action as Action] = {
          action: row.action as Action,
          allowed: row.allowed,
          scope: row.scope as Scope,
          ...(row.fields ? { fields: row.fields } : {}),
          ...(row.constraints ? { constraints: row.constraints } : {}),
          source: row.source,
        };

        if (row.expires_at !== null) {
          if (earliestExpiry === null || row.expires_at < earliestExpiry) {
            earliestExpiry = row.expires_at;
          }
        }
      }

      // AZ-I5 — "cacheDeadline = the earliest expires_at among the principal's
      // unexpired overrides, or the session expiry if there are none. A cached
      // set can NEVER OUTLIVE an override expiry."
      const sessionDeadline = new Date(now.getTime() + 15 * 60_000);
      const cacheDeadline =
        earliestExpiry !== null && earliestExpiry < sessionDeadline
          ? earliestExpiry
          : sessionDeadline;

      return { policies, cacheDeadline, resolvedAt: now } satisfies PermissionSet;
    });
  },
};

/* ==================================================================== *
 * Audit port
 * ==================================================================== */

/**
 * Writes to the audit OUTBOX, never straight to the chain.
 *
 * TX-2 forbids I/O inside a business transaction, and the hash chain needs the
 * single-writer lock on `audit_stream_state`. Taking that lock inline would
 * serialise every request in the organization behind one row.
 */
export const auditPort: AuthzAuditPort = {
  sensitiveUse(ctx, action, resource) {
    enqueue(ctx, 'access', {
      action,
      targetType: resource?.type ?? 'none',
      targetId: resource?.id ?? null,
      kind: 'sensitive-use',
    });
  },

  superAdminBypass(ctx, action, resource) {
    // Step 4 of the pipeline: "accountType === 'super-admin' → allow, AUDITED".
    enqueue(ctx, 'access', {
      action,
      targetType: resource?.type ?? 'none',
      targetId: resource?.id ?? null,
      kind: 'super-admin-bypass',
    });
  },

  segregationBlocked(ctx, action, resource) {
    // SD-5 — "a blocked self-approval is VISIBLE rather than silent."
    enqueue(ctx, 'access', {
      action,
      targetType: resource?.type ?? 'none',
      targetId: resource?.id ?? null,
      kind: 'segregation-blocked',
    });
  },

  defect(ctx, defect, action) {
    // PD-1 — a domain mismatch is a PROGRAMMING ERROR, logged as a defect.
    // §13: authorization denial spikes are a security signal and this pages.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'authorization defect',
        defect,
        action,
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
      }),
    );
  },
};

const pendingAudit = new WeakMap<object, unknown[]>();

function enqueue(ctx: AuthzContext, stream: 'access' | 'activity', payload: unknown): void {
  const queued = pendingAudit.get(ctx.memo) ?? [];
  queued.push({ stream, payload, at: new Date().toISOString() });
  pendingAudit.set(ctx.memo, queued);
}

/** Flushed once per request, after the response, by the audit middleware. */
export async function flushAudit(ctx: RequestContext): Promise<void> {
  const queued = pendingAudit.get(ctx.memo);
  if (!queued || queued.length === 0) return;
  pendingAudit.delete(ctx.memo);

  const principalType = ctx.principal.accountType;
  for (const entry of queued as { stream: string; payload: Record<string, unknown> }[]) {
    await db.query(ctx, sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${ctx.organizationId}, ${entry.stream}, ${JSON.stringify({
        ...entry.payload,
        actorId: ctx.principal.id,
        actorType: principalType,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
      })}::jsonb)
    `);
  }
}

/* ==================================================================== *
 * Boot
 * ==================================================================== */

export function installAuthz(): void {
  configureAuthz({
    scope: scopeResolver,
    policies: policyStore,
    audit: auditPort,
    now: () => new Date(),
  });
}

export type { Resource };
