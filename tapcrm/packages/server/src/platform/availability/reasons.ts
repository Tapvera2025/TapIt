import type { EligibilityReason } from './types.js';

const REASON_TEXT: Readonly<Record<EligibilityReason, string>> = {
  not_active: 'account not active',
  not_punched_in: 'not punched in',
  on_break: 'on a break',
  on_leave: 'on leave today',
  on_holiday: 'holiday today',
  outside_shift: 'outside shift hours',
  at_capacity: 'already holding the most leads allowed',
  cooling_period: 'passed on this lead recently',
  daily_cap_hit: "reached today's claim limit",
  service_unavailable: 'availability could not be checked',
};

/** Why someone can't take a lead, in plain words: "not punched in, on a break". */
export function describeEligibilityReasons(reasons: readonly string[]): string {
  return reasons
    .map(
      (reason) => REASON_TEXT[reason as EligibilityReason] ?? reason.replaceAll('_', ' '),
    )
    .join(', ');
}
