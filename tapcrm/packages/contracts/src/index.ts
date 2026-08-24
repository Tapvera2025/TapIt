/**
 * @tapcrm/contracts — shared types.
 *
 * TECH.md §3: "Shared types. Action union, Scope union, Domain union, DTOs,
 * error codes. Imported by server and client."
 *
 * This package must never import from `authz`, `server` or `client`. It is the
 * bottom of the dependency graph, which is what lets the browser and the API
 * share one definition of an action and makes a breaking contract change a
 * compile error before it is a runtime one (API-6).
 */

export * from './module.js';
export * from './scope.js';
export * from './domain.js';
export * from './money.js';
export * from './errors.js';
export * from './api.js';
export * from './registry.types.js';
export * from './registry.generated.js';
export * from './principal.js';
