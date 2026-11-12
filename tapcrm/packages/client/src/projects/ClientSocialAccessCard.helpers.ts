import type { SocialAccount } from '../social/types.js';

export function connectedByLabel(account: Pick<SocialAccount, 'connectionOrigin'>): string {
  return account.connectionOrigin === 'client_portal' ? 'Connected by client' : 'Connected by your team';
}

export function statusLabel(status: SocialAccount['status']): string {
  if (status === 'connected') return 'Connected';
  if (status === 'reconnect_required') return 'Reconnect needed';
  return 'Disconnected';
}

export function isSocialProject(project: { services: readonly { service: string }[] }): boolean {
  return project.services.some((s) => s.service === 'smo');
}

export function clientPortalSocialUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/client/social`;
}
