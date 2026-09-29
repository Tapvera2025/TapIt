import type { Action } from './registry.generated.js';
import type { ModuleName } from './module.js';
import type { Scope } from './scope.js';
import type { AccountType } from './principal.js';

/** Coarse screen eligibility only. A row's allowedActions decides its controls. */
export interface IdentityBootstrapCapability {
  readonly action: Action;
  /** Super Admin has tenant-wide reach; ordinary policies use a declared scope. */
  readonly scope: Scope | 'global';
}

export interface IdentityBootstrap {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly accountType: AccountType;
  };
  readonly organization: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly status: string;
    readonly timezone: string;
  } | null;
  readonly enabledModules: readonly ModuleName[];
  readonly capabilities: readonly IdentityBootstrapCapability[];
}
