import { registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Shifts resource policy for holidays.
 *
 * Every employee reads holidays (HO-4: matrix gives `holidays` at `all-ppl*`),
 * so the check simply verifies organization membership. `holidays:manage` is
 * held by HR positions and uses the same check — there is no per-person
 * holiday to scope down.
 */
export const holidayPolicy: ResourcePolicy = {
  resourceType: 'holiday',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  filter: async () => ({ sql: 'TRUE', parameters: [] }),
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerHolidayPolicies(): void {
  registerResourcePolicy(holidayPolicy);
}
