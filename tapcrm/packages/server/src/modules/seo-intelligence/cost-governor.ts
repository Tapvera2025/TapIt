/**
 * Budget guard for paid SEO provider calls.
 *
 * Default policy: $0 — all paid calls are blocked until an admin
 * explicitly raises the monthly ceiling in seo_scan_configs.paid_budget_cents.
 * Free-tier calls (state === 'free') always pass.
 */

import { sql } from '../../platform/dal/sql.js';
import { db } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { SeoBudgetBlockedError } from './errors.js';

/** Returns the live MTD spend in cents for a site within the calling org. */
async function mtdSpendCents(ctx: RequestContext, siteId: string): Promise<number> {
  const result = await db.maybeOne<{ total: string }>(ctx, sql`
    SELECT COALESCE(SUM(cost_cents), 0)::text AS total
    FROM seo_provider_usage
    WHERE organization_id = ${ctx.organizationId}
      AND site_id       = ${siteId}
      AND billed_at    >= date_trunc('month', now() AT TIME ZONE 'UTC')
  `);
  return result ? parseInt(result.total, 10) : 0;
}

/** Returns the configured monthly budget ceiling in cents (0 = hard stop). */
async function budgetCeilingCents(ctx: RequestContext, siteId: string): Promise<number> {
  const result = await db.maybeOne<{ paid_budget_cents: number }>(ctx, sql`
    SELECT COALESCE(c.paid_budget_cents, 0) AS paid_budget_cents
    FROM seo_scan_configs c
    WHERE c.organization_id = ${ctx.organizationId}
      AND c.site_id         = ${siteId}
    ORDER BY c.created_at DESC
    LIMIT 1
  `);
  return result?.paid_budget_cents ?? 0;
}

/**
 * Call before any paid provider request.
 * Throws SeoBudgetBlockedError if the spend would exceed the ceiling.
 *
 * @param estimatedCents  Conservative upper-bound cost for this single call.
 */
export async function assertBudget(
  ctx: RequestContext,
  siteId: string,
  estimatedCents: number,
): Promise<void> {
  const [ceiling, mtd] = await Promise.all([
    budgetCeilingCents(ctx, siteId),
    mtdSpendCents(ctx, siteId),
  ]);

  if (ceiling === 0) {
    throw new SeoBudgetBlockedError(
      'Paid provider calls are disabled. Set a monthly budget in SEO Intelligence → Settings → Providers to enable them.',
    );
  }

  if (mtd + estimatedCents > ceiling) {
    const remaining = Math.max(0, ceiling - mtd);
    throw new SeoBudgetBlockedError(
      `Monthly SEO provider budget exhausted. ` +
        `Remaining: ${remaining}¢, required: ${estimatedCents}¢, ceiling: ${ceiling}¢. ` +
        `Raise the budget in SEO Intelligence → Settings → Providers.`,
    );
  }
}

/** Record actual spend after a successful paid call. */
export async function recordUsage(ctx: RequestContext, args: {
  siteId: string;
  scanRunId: string | null;
  provider: string;
  operation: string;
  units: number;
  unitType: string;
  billedCents: number;
}): Promise<void> {
  await db.query(ctx, sql`
    INSERT INTO seo_provider_usage
      (organization_id, site_id, scan_run_id, provider, operation, units, unit_type, cost_cents, billed_at)
    VALUES
      (${ctx.organizationId}, ${args.siteId}, ${args.scanRunId}, ${args.provider},
       ${args.operation}, ${args.units}, ${args.unitType}, ${args.billedCents}, now())
  `);
}
