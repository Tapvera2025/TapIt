import { REGISTRY } from '@tapcrm/contracts';

/**
 * Module-aware access helpers. The server rejects every API call for a module
 * that is switched off for the organization (403 "Module ... is not enabled"),
 * super-admins included, so the client must never offer a screen, nav item or
 * widget for a disabled module -- whatever the viewer's account type.
 */

/** True when the module that owns `action` is enabled. Unknown actions are denied. */
export function isActionModuleEnabled(
  enabledModules: readonly string[],
  action: string,
): boolean {
  const definition = (REGISTRY as Record<string, { module: string } | undefined>)[action];
  if (!definition) return false;
  return enabledModules.includes(definition.module);
}

export interface ModuleAccessSubject {
  readonly isSuperAdmin: boolean;
  readonly enabledModules: readonly string[];
  readonly capabilities: readonly { readonly action: string; readonly scope?: string }[];
}

/**
 * `can(action)`, or a super-admin whose organization has the action's module
 * enabled. The server already limits `capabilities` to enabled modules; the
 * explicit module check keeps the super-admin shortcut from bypassing it.
 */
export function superAdminOr(subject: ModuleAccessSubject, action: string): boolean {
  if (subject.capabilities.some((item) => item.action === action)) return true;
  return subject.isSuperAdmin && isActionModuleEnabled(subject.enabledModules, action);
}

/** Like `superAdminOr`, but a held capability must reach beyond the holder's own records. */
export function superAdminOrBeyondOwn(subject: ModuleAccessSubject, action: string): boolean {
  if (subject.capabilities.some((item) => item.action === action && item.scope !== 'own')) {
    return true;
  }
  return subject.isSuperAdmin && isActionModuleEnabled(subject.enabledModules, action);
}

/**
 * Actions whose list endpoints land the Recruitment workspace (BINDINGS:
 * metrics, requisitions, candidates, interviews, offers, joining). Holding any
 * of them lets a non-HR user open the workspace.
 */
export const RECRUITMENT_VIEW_ACTIONS: readonly string[] = [
  'recruitment:view-metrics',
  'recruitment:view-requisitions',
  'recruitment:view-candidates',
  'recruitment:view-interviews',
  'recruitment:view-offers',
  'recruitment:view-joining',
];

/** True when any recruitment view power is held (module check is the caller's job). */
export function hasRecruitmentViewAction(actions: ReadonlySet<string>): boolean {
  return RECRUITMENT_VIEW_ACTIONS.some((action) => actions.has(action));
}
