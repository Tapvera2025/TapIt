import { PlatformValidationError } from '../errors.js';
import type { ModuleRow } from './repository.js';

/**
 * Module change rules for Master Admin, free of I/O so they are unit-tested
 * (plan.test.ts). `service.applyOrganizationModuleChanges` loads the catalogue
 * and the company's entitlements, asks this for a plan, then writes it.
 */
export interface ModuleChangePlan {
  /** What provisioning must cover: requested modules, their dependencies and core. */
  readonly enableClosure: ReadonlySet<string>;
  readonly newlyEnabled: readonly string[];
  readonly newlyDisabled: readonly string[];
  /** Rows to write as disabled (currently enabled, or never recorded). */
  readonly disableRows: readonly string[];
}

/**
 * The rules of a module change, free of I/O so they can be unit-tested.
 * Throws PlatformValidationError when the change is not allowed.
 */
export function planModuleChanges(input: {
  modules: readonly Pick<ModuleRow, 'id' | 'key' | 'name' | 'isCore'>[];
  edges: readonly { moduleId: string; dependsOnModuleId: string }[];
  current: readonly { key: string; status: string }[];
  enable: readonly string[];
  disable: readonly string[];
}): ModuleChangePlan {
  const { modules: all, edges, current, enable, disable } = input;
  const byKey = new Map(all.map((item) => [item.key, item]));
  const byId = new Map(all.map((item) => [item.id, item]));
  const name = (key: string) => byKey.get(key)?.name ?? key;

  const unknown = [...enable, ...disable].filter((key) => !byKey.has(key));
  if (unknown.length)
    throw new PlatformValidationError(`Unknown or inactive modules: ${unknown.join(', ')}`);

  const coreDisables = disable.filter((key) => byKey.get(key)!.isCore);
  if (coreDisables.length)
    throw new PlatformValidationError(
      `${coreDisables.map(name).join(', ')} ${
        coreDisables.length === 1 ? 'is' : 'are'
      } always on and cannot be disabled`,
    );

  const dependenciesOf = new Map<string, string[]>();
  for (const edge of edges) {
    const module = byId.get(edge.moduleId);
    if (!module) continue;
    const dependency = byId.get(edge.dependsOnModuleId);
    if (!dependency) {
      // An inactive dependency can never be satisfied.
      if (enable.includes(module.key))
        throw new PlatformValidationError(`Module "${module.key}" has an unavailable dependency`);
      continue;
    }
    dependenciesOf.set(module.key, [...(dependenciesOf.get(module.key) ?? []), dependency.key]);
  }

  // Dependency closure of what is being switched on. Core modules are added
  // afterwards (enabling anything guarantees the always-on modules are there)
  // but their own dependency edges are not followed: a core module works for
  // every company on its own — Tasks must not drag Projects in with it.
  const enableClosure = new Set<string>(enable);
  const queue = [...enableClosure];
  while (queue.length) {
    for (const dependency of dependenciesOf.get(queue.shift()!) ?? []) {
      if (!enableClosure.has(dependency)) {
        enableClosure.add(dependency);
        queue.push(dependency);
      }
    }
  }
  if (enable.length)
    for (const item of all) if (item.isCore) enableClosure.add(item.key);

  const currentlyEnabled = new Set(
    current.filter((row) => row.status === 'enabled').map((row) => row.key),
  );
  const disabling = new Set(disable);
  const finalEnabled = new Set(
    [...currentlyEnabled, ...enableClosure].filter((key) => !disabling.has(key)),
  );

  // Only dependencies broken BY THIS CHANGE are refused; a company already in
  // an inconsistent state can still be edited.
  const blocked = new Map<string, string[]>();
  for (const key of finalEnabled) {
    if (byKey.get(key)?.isCore) continue; // core modules stand alone (see above)
    for (const dependency of dependenciesOf.get(key) ?? []) {
      if (disabling.has(dependency))
        blocked.set(dependency, [...(blocked.get(dependency) ?? []), key]);
    }
  }
  if (blocked.size)
    throw new PlatformValidationError(
      [...blocked]
        .map(
          ([dependency, dependents]) =>
            `${name(dependency)} is needed by ${dependents.map(name).sort().join(', ')}`,
        )
        .join('; ') + '. Disable those modules as well, or keep this one on.',
    );

  const hasRow = new Set(current.map((row) => row.key));
  return {
    enableClosure,
    newlyEnabled: [...finalEnabled].filter((key) => !currentlyEnabled.has(key)).sort(),
    newlyDisabled: disable.filter((key) => currentlyEnabled.has(key)).sort(),
    // A disable of a module that never had a row still records the decision.
    disableRows: disable.filter((key) => currentlyEnabled.has(key) || !hasRow.has(key)),
  };
}
