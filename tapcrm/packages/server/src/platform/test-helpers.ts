import type { RequestContext } from './dal/context.js';
import { createJobContext, systemPrincipal } from './dal/context.js';

/**
 * Creates a minimal RequestContext suitable for use in integration tests.
 * The principal is a service principal scoped to the given organization,
 * with the given userId set as the principal id so that ownership checks
 * (requestedBy === ctx.principal.id) work correctly.
 */
export function createTestContext(organizationId: string, userId: string): RequestContext {
  const principal = {
    ...systemPrincipal(organizationId),
    id: userId,
  };
  return createJobContext({
    organizationId,
    principal,
    jobName: 'test',
    runId: `test:${userId}`,
  });
}
