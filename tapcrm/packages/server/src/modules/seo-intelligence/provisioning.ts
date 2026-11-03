import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { getSeoRuleCopy } from '@tapcrm/contracts';

// Importing the rule index triggers side-effect registrations for all rule groups.
import { getAllRules } from './crawler/rules/index.js';

/**
 * Seed per-tenant rule configuration from the global rule catalogue.
 *
 * Seeds every rule in the registry (not just active+tested ones) so admins can
 * toggle currently-disabled rules on from the Rules Admin UI. ON CONFLICT DO
 * NOTHING keeps re-provisioning safe without overwriting manual tenant overrides.
 */
export async function provisionSeoRules(tx: Tx, organizationId: string): Promise<number> {
  const rules = getAllRules();
  let inserted = 0;

  for (const rule of rules) {
    const rows = await tx.query<{ id: string }>(sql`
      INSERT INTO registry_seo_rule
        (organization_id, rule_id, rule_group, severity, active, tested, description)
      VALUES
        (${organizationId}, ${rule.ruleId}, ${rule.group}, ${rule.severity},
         ${rule.active}, ${rule.tested}, ${getSeoRuleCopy(rule.ruleId).description})
      ON CONFLICT (organization_id, rule_id) DO NOTHING
      RETURNING id
    `);
    inserted += rows.length;
  }

  return inserted;
}
