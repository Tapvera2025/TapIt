import {
  DENY,
  MATCH_NOTHING,
  PASS,
  registerConstraint,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { DateOnly, Scope } from '@tapcrm/contracts';
import { daysBetween } from '../../platform/time.js';

/**
 * `attendanceRecord` resource policy — mirrors `userPolicy` (§8.7).
 *
 *   own          → the record belongs to the caller
 *   team         → the record's subject is on one of the caller's teams
 *   department   → the record's subject is in the caller's department
 *   pool         → same as team but through the pool teams
 *   all-people   → all records in the tenant
 *
 * The filter clause targets `app_user u` — the caller must JOIN
 * `app_user u ON u.id = r.user_id` when using it. That reflects the
 * subject's CURRENT placement, which is the read-authorization question
 * ("which people am I allowed to see records of"). The DAY DETAIL of an
 * already-calculated day uses the record's `placement_snapshot` instead —
 * that answers "which department did this row belong to when it was
 * computed?", a different question.
 */
export const attendanceRecordPolicy: ResourcePolicy = {
  resourceType: 'attendanceRecord',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    if (scope === 'department') {
      return resource['departmentId'] === (await ctx.scope.departmentId(ctx));
    }
    const teamId = resource['teamId'];
    if (typeof teamId !== 'string') return false;
    if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(teamId);
    if (scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(teamId);
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [departmentId] };
    }
    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      return teams.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
    }
    if (scope === 'pool') {
      const pools = [...(await ctx.scope.poolIds(ctx))];
      return pools.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [pools] };
    }
    return MATCH_NOTHING;
  },
  participantFields() {
    return [];
  },
  initiatorField() {
    return null;
  },
};

export const CORRECTION_LOOKBACK_DAYS = 60;

export const attendanceCorrectionPolicy: ResourcePolicy = {
  resourceType: 'attendanceCorrection',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    if (scope === 'department') {
      const departmentId = resource['departmentId'];
      return typeof departmentId === 'string' &&
        departmentId === (await ctx.scope.departmentId(ctx));
    }
    const userId = resource['userId'];
    if (typeof userId !== 'string') return false;
    if (scope === 'pool') return (await ctx.scope.poolMemberIds(ctx)).has(userId);
    const teamId = resource['teamId'];
    if (scope === 'team' && typeof teamId === 'string')
      return (await ctx.scope.teamIds(ctx)).has(teamId);
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [departmentId] };
    }
    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      return teams.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
    }
    if (scope === 'pool') {
      const members = [...(await ctx.scope.poolMemberIds(ctx))];
      return members.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.id = ANY($1::uuid[])', parameters: [members] };
    }
    return MATCH_NOTHING;
  },
  participantFields() { return []; },
  initiatorField() { return 'requestedBy'; },
};

export function registerAttendancePolicies(): void {
  registerResourcePolicy(attendanceRecordPolicy);
  registerResourcePolicy(attendanceCorrectionPolicy);

  // AT-10 — Privileged (step 5): runs AFTER the Super Admin bypass (step 4), so
  // Super Admin is exempt automatically. Every other principal is denied on days
  // older than CORRECTION_LOOKBACK_DAYS.
  registerConstraint({
    id: 'P9',
    kind: 'privileged',
    appliesTo: ['attendance:correct', 'attendance:raise-correction', 'attendance:request-correction'],
    describe: `AT-10: corrections on days older than ${CORRECTION_LOOKBACK_DAYS} days are Super Admin only.`,
    evaluate: (_ctx, _action, resource) => {
      if (resource === undefined || resource.type !== 'attendanceCorrection') return PASS;
      const workDate = resource['workDate'] as string | undefined;
      const today = resource['organizationToday'] as string | undefined;
      if (!workDate || !today)
        return DENY('P9: correction resource lacks workDate or organizationToday.');
      const ageDays = daysBetween(workDate as DateOnly, today as DateOnly);
      if (ageDays <= CORRECTION_LOOKBACK_DAYS) return PASS;
      return DENY(
        `AT-10: ${workDate} is ${ageDays} days ago. Correcting days older than ` +
        `${CORRECTION_LOOKBACK_DAYS} days is a Super Admin privilege.`,
      );
    },
  });
}
