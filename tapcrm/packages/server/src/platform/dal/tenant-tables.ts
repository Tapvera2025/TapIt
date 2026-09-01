/**
 * The authoritative list of tenant-owned tables.
 *
 * A tenant-owned table is one carrying `organization_id` and protected by an
 * RLS policy (TN-1, TN-2, PG-4). Reaching one without tenant context does not
 * raise an error — the policy simply matches no rows, so the statement succeeds
 * and affects nothing. That is the most dangerous failure shape in this
 * codebase: a write that reports success and does nothing.
 *
 * This list exists so the DAL can REFUSE that reach rather than let it succeed
 * emptily. `platformDb` checks every statement against it.
 *
 * Kept honest by `tools/ci` check TN-LIST, which extracts every
 * `apply_tenant_rls('…')` call from `/migrations` and diffs it against this
 * set. Adding a tenant table without adding it here fails the build; adding a
 * name here that no migration protects fails it too.
 */

export const TENANT_OWNED_TABLES: ReadonlySet<string> = new Set([
  'app_user',
  'approval_delegation',
  'audit_entry',
  'audit_entry_default',
  'audit_outbox',
  'audit_stream_state',
  'department',
  'designation',
  'domain_outbox',
  'email_verification_token',
  'employee_invitation',
  'employee_profile',
  'geofence_assignment',
  'geofence_event',
  'geofence_location',
  'job_run',
  'mfa_enrollment',
  'mfa_recovery_code',
  'password_reset_token',
  'position',
  'position_policy',
  'refresh_token',
  'role_change_request',
  'service_account',
  'session',
  'team',
  'user_override',
]);

/**
 * Tables that are genuinely NOT tenant-owned, and the only ones a cross-tenant
 * surface may name.
 *
 * TN-3: "Genuinely global reference data lives in explicitly global tables.
 * ADDING A NEW GLOBAL TABLE REQUIRES REVIEW." This constant is that review,
 * expressed in code — the diff is small enough that adding to it is visible.
 *
 * `organization` is here because it is the tenant ROOT: a row cannot gate
 * itself, so it carries no `organization_id` and no tenant policy. Reading it
 * is how a login request turns an organization code into an id before any
 * tenant context can exist.
 */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  'organization',
  'schema_migrations',
  'country',
  'currency',
]);

/**
 * Finds tenant-owned tables named anywhere in a SQL statement.
 *
 * This is deliberately a coarse word-boundary scan rather than a parser. It is
 * a guardrail, not a security boundary — RLS is the security boundary. Its job
 * is to turn "this write silently did nothing" into a loud error during
 * development, and a coarse scan that over-reports is exactly right for that:
 * a false positive is a five-second fix, a false negative is an outage nobody
 * notices for a month.
 */
export function tenantTablesNamedIn(sql: string): readonly string[] {
  // Strip string literals and comments so a table name inside a message or a
  // column comment does not trip the check.
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  const found: string[] = [];
  for (const table of TENANT_OWNED_TABLES) {
    if (new RegExp(`(?<![A-Za-z0-9_])${table}(?![A-Za-z0-9_])`).test(stripped)) {
      found.push(table);
    }
  }
  return found.sort();
}
