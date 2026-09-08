export type PlatformRole = 'MASTER_ADMIN';

export interface PlatformPrincipal {
  readonly id: string;
  readonly platformUserId: string;
  readonly role: PlatformRole;
  readonly sessionVersion: number;
}
