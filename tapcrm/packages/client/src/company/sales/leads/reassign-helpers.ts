/**
 * Pure helpers for the reassign modal + button gating (R1 plan step 1.15).
 */

const HOD_HINTS = ['hod', 'head', 'manager', 'director'];

export interface PrincipalForReassign {
  readonly accountType: 'super-admin' | 'employee' | 'client' | 'service';
  readonly positionCode?: string | null;
  readonly departmentCode?: string | null;
}

/**
 * Server-side gate is `leads:reassign`; the client's job is to hide the
 * button for people who cannot hold the action. Super Admin always qualifies;
 * employees with a HOD/head/manager-flavoured position in the sales
 * department also qualify. Anyone else never sees the button in R1.
 */
export function canReassignLead(principal: PrincipalForReassign): boolean {
  if (principal.accountType === 'super-admin') return true;
  if (principal.accountType !== 'employee') return false;
  const dept = (principal.departmentCode ?? '').toLowerCase();
  if (!dept.includes('sales')) return false;
  const position = (principal.positionCode ?? '').toLowerCase();
  return HOD_HINTS.some((hint) => position.includes(hint));
}

/** Only Super Admin may transfer sourcing credit (plan R-ROUTE-05). */
export function canTransferSourcingCredit(principal: PrincipalForReassign): boolean {
  return principal.accountType === 'super-admin';
}

export interface ReassignFormInput {
  readonly newOwnerId: string;
  readonly reason: string;
  readonly transferPendingCallbacks: boolean;
  readonly transferScheduledActivities: boolean;
  readonly transferSourcingCredit: boolean;
}

export interface FormProblems {
  readonly newOwnerId?: string;
  readonly reason?: string;
}

export function validateReassignForm(input: ReassignFormInput): FormProblems {
  const problems: { newOwnerId?: string; reason?: string } = {};
  if (!input.newOwnerId) problems.newOwnerId = 'Pick a new owner';
  const trimmed = input.reason.trim();
  if (trimmed.length < 5) problems.reason = 'Reason must be at least 5 characters';
  if (trimmed.length > 500) problems.reason = 'Reason is capped at 500 characters';
  return problems;
}

export function hasFormProblems(problems: FormProblems): boolean {
  return problems.newOwnerId !== undefined || problems.reason !== undefined;
}
