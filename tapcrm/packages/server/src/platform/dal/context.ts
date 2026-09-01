import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';

/**
 * RequestContext — TECH.md TN-5.
 *
 *   "A RequestContext carries organizationId, principal and request id. It
 *    CANNOT BE CONSTRUCTED without an organization for tenant-bound work."
 *
 * That last clause is the whole design. The constructor below is the only way
 * to make one, and it refuses to produce a context with an absent tenant. T-3:
 * no tenant query without tenant context.
 */
export interface RequestContext {
  readonly organizationId: string;
  readonly principal: Principal;
  readonly requestId: string;
  /** Memoises scope resolution and the permission set for the request (NF-5). */
  readonly memo: Map<string, unknown>;
  /** Source address, recorded on every audit entry (AU-10). */
  readonly sourceIp: string | null;
}

export class MissingTenantContextError extends Error {
  constructor(detail: string) {
    super(
      `TN-5: ${detail}. A tenant-bound unit of work cannot run without an organization ` +
        'context. This is a defect, not a permission denial.',
    );
    this.name = 'MissingTenantContextError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRequestContext(input: {
  organizationId: string;
  principal: Principal;
  requestId: string;
  sourceIp?: string | null;
}): RequestContext {
  if (!input.organizationId) {
    throw new MissingTenantContextError('organizationId is empty');
  }
  if (!UUID.test(input.organizationId)) {
    // Rejected here rather than at the database: the value is interpolated into
    // `set_config`, and a non-UUID reaching that call is exactly the shape of a
    // tenant-boundary attack.
    throw new MissingTenantContextError(
      `organizationId "${input.organizationId}" is not a UUID`,
    );
  }
  if (input.principal.organizationId !== input.organizationId) {
    // MT-6 — Super Admin is scoped to ONE organization. A principal from
    // organization A may never establish context for organization B.
    throw new MissingTenantContextError(
      `principal belongs to organization ${input.principal.organizationId}, ` +
        `context is for ${input.organizationId}`,
    );
  }

  return {
    organizationId: input.organizationId,
    principal: input.principal,
    requestId: input.requestId,
    memo: new Map<string, unknown>(),
    sourceIp: input.sourceIp ?? null,
  };
}

/**
 * TN-9 / JB-3 — "Background jobs construct a context PER ORGANIZATION. A job
 * iterating organizations does so explicitly; it never runs with an absent
 * tenant context."
 */
export function createJobContext(input: {
  organizationId: string;
  principal: Principal;
  jobName: string;
  runId: string;
}): RequestContext {
  return createRequestContext({
    organizationId: input.organizationId,
    principal: input.principal,
    requestId: `job:${input.jobName}:${input.runId}`,
    sourceIp: null,
  });
}

/**
 * The context for authentication's own writes — issuing a session, rotating a
 * refresh token.
 *
 * These happen at the moment a principal is being established, so there is no
 * resolved `Principal` yet: no position, no department, no team. That is a real
 * gap, and the honest way to fill it is a named factory that says so — not an
 * object literal cast into shape at the call site with `as`, which is what this
 * replaces. A forged literal skips every check in `createRequestContext`,
 * including the one that stops a principal from one organization establishing
 * context for another (MT-6).
 *
 * The principal it builds carries no authority. It exists to satisfy tenancy
 * and to name an actor in the audit trail. Nothing on this path calls the
 * authorization engine, because there is no policy question to ask — proving
 * the password is the whole decision — and if some future change did call it,
 * absolute constraint A2 would refuse this principal against every resource.
 * Failing closed is the point.
 */
export function createAuthContext(input: {
  organizationId: string;
  userId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  purpose: 'session-issue' | 'session-refresh';
  sourceIp: string | null;
}): RequestContext {
  if (!UUID.test(input.userId)) {
    throw new MissingTenantContextError(`userId "${input.userId}" is not a UUID`);
  }

  const principal: Principal =
    input.accountType === 'super-admin'
      ? {
          id: input.userId,
          organizationId: input.organizationId,
          sessionVersion: 0,
          accountType: 'super-admin',
        }
      : {
          id: input.userId,
          organizationId: input.organizationId,
          sessionVersion: 0,
          accountType: 'client',
          clientId: input.userId,
        };

  return createRequestContext({
    organizationId: input.organizationId,
    principal,
    requestId: `auth:${input.purpose}:${randomUUID()}`,
    sourceIp: input.sourceIp,
  });
}
