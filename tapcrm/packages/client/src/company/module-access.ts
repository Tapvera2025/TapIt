import { REGISTRY } from '@tapcrm/contracts';

/**
 * Module-aware access helpers. The server rejects every API call for a module
 * that is switched off for the organization (403 "Module ... is not enabled"),
 * super-admins included, so the client must never offer a screen, nav item or
 * widget for a disabled module -- whatever the viewer's account type.
 *
 * Who may open which screen is decided in one place, the screen list in
 * layout/navigation.ts (`holdsPower`, `canOpenScreen`).
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
