import { ACTION_COPY } from './actionCopy.js';
import type { Action } from './registry.generated.js';
import type { ActionDefinition } from './registry.types.js';
import type { Scope } from './scope.js';
import { SCOPES } from './scope.js';

export { ACTION_COPY, type ActionCopy } from './actionCopy.js';

function copyFor(action: string) {
  return Object.prototype.hasOwnProperty.call(ACTION_COPY, action)
    ? ACTION_COPY[action as Action]
    : undefined;
}

/**
 * Presentation helpers for the canonical action registry.
 *
 * This is intentionally derived from REGISTRY entries. It is not a second
 * permission catalogue: authorization, action identity, module ownership and
 * protected-capability flags remain owned by registry.generated.ts.
 */
export function actionTitle(action: string): string {
  const copy = copyFor(action);
  if (copy) return copy.title;
  const name = action.includes(':') ? action.slice(action.indexOf(':') + 1) : action;
  return name
    .split(/[._-]/g)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Everyday names for the modules, as the people handing out powers know them. */
const MODULE_TITLES: Partial<Record<ActionDefinition['module'], string>> = {
  identity: 'Sign-in & accounts',
  organization: 'Organization structure',
  'access-management': 'Access & position changes',
  audit: 'Audit log',
  'system-administration': 'System settings',
  'employee-directory': 'Employees',
  'live-status': 'Punching',
  'break-management': 'Breaks',
  biometric: 'Attendance machines',
  leave: 'Leave & work from home',
  handoff: 'Project handoff',
  'resource-planning': 'Resource planning',
  'post-closure': 'Renewals',
  'client-portal': 'Client portal',
  'billing-terms': 'Billing terms',
  payables: 'Payables & expenses',
  'project-communication': 'Project conversations',
  reporting: 'Reports',
};

export function moduleTitle(moduleName: ActionDefinition['module']): string {
  const named = MODULE_TITLES[moduleName];
  if (named) return named;
  return moduleName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * One sentence of what the power means in practice. The plain-language copy
 * wins; the registry's own description and a derived phrase are fallbacks.
 */
export function actionDescription(definition: ActionDefinition<Action>): string {
  const copy = copyFor(definition.action);
  if (copy) return copy.description;
  const sourceDescription = definition.description.trim();
  if (sourceDescription) return sourceDescription;
  const resource = definition.resource
    ? definition.resource.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
    : `${moduleTitle(definition.module)} data`;
  return `${actionTitle(definition.action)} ${resource.toLowerCase()}.`;
}

/**
 * The current PRD screen inventory is module-owned. Until individual screen
 * metadata is added to the source registry, expose the owning module and the
 * resource as the feature unlocked by the action.
 */
export function actionScreens(definition: ActionDefinition<Action>): string[] {
  const resource = definition.resource
    ? definition.resource
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (character: string) => character.toUpperCase())
    : `${moduleTitle(definition.module)} features`;
  return [`${moduleTitle(definition.module)} · ${resource}`];
}

/**
 * Scope choices are filtered by the same domain contract used by the server.
 * `all-people` is meaningful only for people-domain resources.
 */
export function actionScopes(definition: ActionDefinition<Action>): Scope[] {
  if (definition.domain === 'business') {
    return SCOPES.filter((scope) => scope !== 'all-people');
  }
  return [...SCOPES];
}

const SCOPE_LABELS: Record<Scope, { label: string; hint: string }> = {
  own: { label: 'Just their own', hint: 'Only their own records.' },
  participant: { label: "Things they're part of", hint: 'Records they are named on, such as a deal or delivery they work on.' },
  // A pool is the holder's own team, without the teams under it (a supervisor's view).
  pool: { label: 'Their own team only', hint: 'The people in their own team, not the teams under it.' },
  team: { label: 'Their team and teams below', hint: 'Everyone in their team and in the teams under it.' },
  department: { label: 'Their department', hint: 'Everyone in their department.' },
  'all-people': { label: 'Everyone in the company', hint: 'Every employee in the company.' },
};

/** "Who does this power reach?" in everyday words: "Their team". */
export function scopeLabel(scope: string): string {
  return (SCOPE_LABELS as Record<string, { label: string } | undefined>)[scope]?.label ?? scope;
}

/** A short explanation of a scope choice: "Their team and the teams under it." */
export function scopeHint(scope: string): string {
  return (SCOPE_LABELS as Record<string, { hint: string } | undefined>)[scope]?.hint ?? '';
}

/**
 * Position policies may grant only actions that are both explicitly
 * position-grantable and not reserved for the Super Admin authorization path.
 * This is derived from the canonical registry and is shared by the UI and
 * server-side policy validation.
 */
export function isPositionPolicyGrantable(definition: ActionDefinition<Action>): boolean {
  return (
    definition.grantPolicy.positionGrantable && !definition.grantPolicy.superAdminOnly
  );
}

export function protectedCapabilityReason(
  definition: ActionDefinition<Action>,
): string | null {
  if (!isPositionPolicyGrantable(definition)) {
    if (
      definition.grantPolicy.positionGrantable &&
      definition.grantPolicy.superAdminOnly
    ) {
      return 'Only the Super Admin can do this.';
    }
    return 'Only the Super Admin can do this; it cannot be given to a position.';
  }
  return null;
}
