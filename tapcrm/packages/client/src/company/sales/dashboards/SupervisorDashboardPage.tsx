import { Page } from '../../../ui/components.js';
import { ClaimsDistribution } from './ClaimsDistribution.js';
import { PoolHealth } from './PoolHealth.js';

/**
 * Supervisor dashboard shell (R1 plan step 1.17). Two cards — pool
 * health and per-agent claims — refreshing on their own cadence so a
 * manager can keep this page open across a shift.
 */
export function SupervisorDashboardPage(): React.JSX.Element {
  return (
    <Page
      eyebrow="Sales"
      title="Supervisor dashboard"
      description="Pool health and claims distribution across the sales team."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <PoolHealth />
        <ClaimsDistribution />
      </div>
    </Page>
  );
}
