import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { markExpiredOverrides } from './repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maintenance only. `authz-adapter` excludes expired rows at read time; this
 * job merely records an idempotent expiry event for review/audit purposes.
 * Moved from platform/jobs.ts unchanged, now one run per organization.
 */
export function registerAccessManagementJobs(): void {
  defineJob({
    name: 'access.audit-expired-overrides',
    perOrganization: true,
    schedule: { every: DAY_MS },
    handler: async ({ ctx }) => {
      const expired = await db.transaction(ctx, async (tx) => {
        const rows = await markExpiredOverrides(tx);
        for (const override of rows) {
          await tx.query(sql`
            INSERT INTO audit_outbox (organization_id, stream, payload)
            VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
              action: 'access.override_expired',
              actorId: null,
              actorType: 'service',
              targetType: 'user',
              targetId: override.userId,
              before: {
                overrideId: override.id,
                action: override.action,
                allowed: override.allowed,
                scope: override.scope,
                expiresAt: override.expiresAt.toISOString(),
              },
              after: null,
              reason: override.reason,
            })}::jsonb)
          `);
        }
        return rows;
      });
      return { itemsProcessed: expired.length };
    },
  });
}
