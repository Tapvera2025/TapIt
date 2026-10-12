/**
 * Sales v1.1 — direct-assignment router (R1 plan step 1.4).
 *
 * `assignOne` runs inside the caller's transaction and picks a single agent
 * from a sales pool using the "fewest weighted workload" strategy. It:
 *
 *   1. Takes a Postgres advisory lock scoped to the pool id, so concurrent
 *      calls on the same pool serialize for the duration of the transaction
 *      and no two of them pick the same agent off a stale snapshot.
 *   2. Reads the pool roster (`app_user` where `team_id = pool`).
 *   3. Calls the availability facade and workload query in parallel.
 *   4. Scores each eligible agent as `activeLeads + overdueWeight * overdueCallbacks`.
 *   5. Returns the lowest score with a stable `lower(user_id)` tie-break.
 *
 * The caller is responsible for writing the lead's new state (owner,
 * holder, SLA) once it has the assignment — the router does not mutate
 * `lead`. This keeps `markFallbackAssigned`, `markReassigned` and similar
 * callers in the single transaction that owns the state transition.
 *
 * Round-robin is not implemented in R1 — the plan explicitly disables it
 * and asks the router to fail loudly if requested.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { evaluateAvailability } from '../../../platform/availability/service.js';
import { fetchWorkload } from './capacity.js';

export type RoutingStrategy = 'fewest_workload' | 'round_robin';

export class UnimplementedRoutingStrategyError extends Error {
  readonly code = 'UNIMPLEMENTED';
  constructor(public readonly strategy: string) {
    super(`routing strategy '${strategy}' is not implemented in v1.1 R1`);
    this.name = 'UnimplementedRoutingStrategyError';
  }
}

export interface AssignmentCandidate {
  readonly userId: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly activeLeadCount: number;
  readonly overdueCallbackCount: number;
  readonly weightedScore: number;
}

export interface AssignmentResult {
  readonly userId: string;
  readonly weightedScore: number;
  readonly candidates: readonly AssignmentCandidate[];
  readonly strategy: 'fewest_workload';
}

export interface AssignOptions {
  readonly excludeAgentIds?: readonly string[];
  /** Reserved for the fallback path once org-level parent pools exist. */
  readonly expandToParentPool?: boolean;
  readonly strategy?: RoutingStrategy;
  /** Weight applied to overdue callbacks when scoring workload. Default 2. */
  readonly overdueWeight?: number;
  /** Override the availability facade's active-lead cap for routing. */
  readonly activeLeadMax?: number;
}

export interface LeadRoutingTarget {
  readonly id: string;
  readonly organizationId: string;
  readonly salesPoolId: string | null;
  readonly salesTeamId: string | null;
}

const DEFAULT_OVERDUE_WEIGHT = 2;

export async function assignOne(
  ctx: RequestContext,
  tx: Tx,
  lead: LeadRoutingTarget,
  opts: AssignOptions = {},
): Promise<AssignmentResult | null> {
  const strategy = opts.strategy ?? 'fewest_workload';
  if (strategy !== 'fewest_workload') throw new UnimplementedRoutingStrategyError(strategy);

  const poolId = lead.salesPoolId;
  if (!poolId) return null;

  await tx.query(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('sales-pool-routing:' || ${poolId}::text, 0)
    )
  `);

  const members = await tx.query<{ userId: string }>(sql`
    SELECT id AS "userId"
      FROM app_user
     WHERE organization_id = ${ctx.organizationId}
       AND team_id         = ${poolId}
       AND status          = 'active'
  `);
  const excluded = new Set(opts.excludeAgentIds ?? []);
  const candidateIds = members.map((m) => m.userId).filter((id) => !excluded.has(id));
  if (candidateIds.length === 0) return null;

  const availabilityOpts =
    opts.activeLeadMax !== undefined
      ? { pool: 'direct' as const, caps: { activeLeadMax: opts.activeLeadMax } }
      : { pool: 'direct' as const };
  const [availability, workload] = await Promise.all([
    evaluateAvailability(ctx, candidateIds, availabilityOpts),
    fetchWorkload(tx, ctx.organizationId, candidateIds),
  ]);
  const loadByUserId = new Map(workload.map((w) => [w.userId, w]));
  const overdueWeight = opts.overdueWeight ?? DEFAULT_OVERDUE_WEIGHT;

  const candidates: AssignmentCandidate[] = availability.map((a) => {
    const load = loadByUserId.get(a.userId) ?? {
      userId: a.userId,
      activeLeadCount: 0,
      overdueCallbackCount: 0,
    };
    return {
      userId: a.userId,
      eligible: a.eligible,
      reasons: a.reasons,
      activeLeadCount: load.activeLeadCount,
      overdueCallbackCount: load.overdueCallbackCount,
      weightedScore: load.activeLeadCount + overdueWeight * load.overdueCallbackCount,
    };
  });

  const eligible = candidates.filter((c) => c.eligible);
  if (eligible.length === 0) return null;

  const winner = [...eligible].sort(
    (a, b) => a.weightedScore - b.weightedScore || a.userId.localeCompare(b.userId),
  )[0]!;

  return {
    userId: winner.userId,
    weightedScore: winner.weightedScore,
    candidates,
    strategy: 'fewest_workload',
  };
}

export const _constants = { DEFAULT_OVERDUE_WEIGHT };
