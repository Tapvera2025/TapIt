import type { Action, ModuleName } from '@tapcrm/contracts';
import { REGISTRY } from '@tapcrm/contracts';

/**
 * Client route metadata — TECH.md §8.4.
 *
 * Generated from the SAME registry the server uses, which is the point: NF-21
 * says "Client routes and server routes each reference it; neither is itself
 * the source."
 *
 * The critical caveat, verbatim from §8.4:
 *
 *   "`requires` filters the sidebar. `uses` decides which buttons render.
 *    NEITHER PROTECTS DATA — the API binding does, server-side, on every
 *    request (RM-7). A control hidden on the client and unguarded on the server
 *    is not protected; it is merely inconvenient to find."
 *
 * SE-1 says the same thing from the other direction: all authorization is
 * server-side, and client-side filtering is presentation only.
 */
export interface ScreenDefinition {
  readonly path: string;
  readonly module: ModuleName;
  readonly title: string;
  /** Gates NAVIGATION. Presentation only. */
  readonly requires: readonly Action[];
  /** Gates CONTROLS. Presentation only. */
  readonly uses?: readonly Action[];
}

const screens: ScreenDefinition[] = [];

export function screen(definition: ScreenDefinition): ScreenDefinition {
  // Compile-time typing already restricts these to the generated union; this
  // catches a stale generated file at runtime in development.
  for (const action of [...definition.requires, ...(definition.uses ?? [])]) {
    if (!(action in REGISTRY)) {
      throw new Error(
        `Screen ${definition.path} names "${action}", which is not in the action registry. ` +
          'Run `npm run registry:extract`.',
      );
    }
  }
  screens.push(definition);
  return definition;
}

export function registeredScreens(): readonly ScreenDefinition[] {
  return screens;
}

/**
 * Sidebar filtering. Takes the effective action set the server sent for this
 * principal — the client never computes permissions, it only renders them.
 */
export function visibleScreens(held: ReadonlySet<Action>): readonly ScreenDefinition[] {
  return screens.filter((s) => s.requires.every((a) => held.has(a)));
}

export function canRender(held: ReadonlySet<Action>, action: Action): boolean {
  return held.has(action);
}
