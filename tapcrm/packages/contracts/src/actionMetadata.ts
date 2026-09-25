import type { Action } from './registry.generated.js';
import type { ActionDefinition } from './registry.types.js';
import type { Scope } from './scope.js';
import { SCOPES } from './scope.js';

/**
 * Presentation helpers for the canonical action registry.
 *
 * This is intentionally derived from REGISTRY entries. It is not a second
 * permission catalogue: authorization, action identity, module ownership and
 * protected-capability flags remain owned by registry.generated.ts.
 */
export function actionTitle(action: string): string {
  const name = action.includes(':') ? action.slice(action.indexOf(':') + 1) : action;
  return name
    .split(/[._-]/g)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function moduleTitle(moduleName: ActionDefinition['module']): string {
  return moduleName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** A useful fallback for registry rows whose source description is empty. */
export function actionDescription(definition: ActionDefinition<Action>): string {
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
      return 'Protected: Super Admin only.';
    }
    return 'Protected: this capability is Super Admin only and cannot be granted by a position policy.';
  }
  return null;
}
