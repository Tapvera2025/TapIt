import { SOCIAL_PORTAL_PLATFORMS } from '@tapcrm/contracts';
import { IdentityApiError } from '../identity/api/authApi.js';
import type {
  SocialPortalAccount,
  SocialPortalCandidate,
  SocialPortalDisconnectResult,
  SocialPortalOverview,
  SocialPortalPlatform,
} from '@tapcrm/contracts';

export const OAUTH_FRAGMENT_PREFIX = '#social-oauth=';

export const PLATFORM_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  google_business: 'Google Business Profile',
  linkedin: 'LinkedIn',
};

export type OAuthReturn =
  | {
      kind: 'success';
      platform: SocialPortalPlatform;
      code: string;
      state: string;
      clientId: string;
    }
  | { kind: 'denied'; message: string }
  | { kind: 'invalid'; message: string };

const INCOMPLETE =
  'The platform returned an incomplete response. Please try connecting again.';

function isPortalPlatform(value: unknown): value is SocialPortalPlatform {
  return (
    typeof value === 'string' &&
    (SOCIAL_PORTAL_PLATFORMS as readonly string[]).includes(value)
  );
}

/** Reads the value after `#social-oauth=`. Returns null when the hash is not an OAuth return. */
export function parseOAuthFragment(hash: string): OAuthReturn | null {
  if (!hash.startsWith(OAUTH_FRAGMENT_PREFIX)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decodeURIComponent(hash.slice(OAUTH_FRAGMENT_PREFIX.length)));
  } catch {
    return { kind: 'invalid', message: INCOMPLETE };
  }
  if (typeof payload !== 'object' || payload === null)
    return { kind: 'invalid', message: INCOMPLETE };
  const data = payload as Record<string, unknown>;
  if (typeof data['error'] === 'string') {
    return {
      kind: 'denied',
      message:
        typeof data['message'] === 'string' && data['message']
          ? data['message']
          : 'The connection was not authorized. Please try again.',
    };
  }
  const { code, state, platform, clientId } = data;
  if (
    typeof code !== 'string' ||
    typeof state !== 'string' ||
    typeof clientId !== 'string' ||
    !code ||
    !state ||
    !isPortalPlatform(platform)
  )
    return { kind: 'invalid', message: INCOMPLETE };
  return { kind: 'success', platform, code, state, clientId };
}

export function candidateReason(candidate: SocialPortalCandidate): string | null {
  switch (candidate.availability) {
    case 'reconnect':
      return 'Already connected by you — choosing it renews it';
    case 'managed_by_agency':
      return 'Your agency already manages this for you';
    case 'unavailable':
      return 'Connected elsewhere in this CRM — ask your agency to move it';
    default:
      return null;
  }
}

export function isSelectable(candidate: SocialPortalCandidate): boolean {
  return candidate.availability === 'available' || candidate.availability === 'reconnect';
}

/** Which login the "remove access" option affects. */
export function accessProviderName(platform: string): string {
  return platform === 'facebook' || platform === 'instagram' ? 'Facebook' : 'Google';
}

export function revokeWarning(platform: string): string {
  if (platform === 'facebook' || platform === 'instagram')
    return 'This removes TapIt’s access for your whole Facebook login: every Page and Instagram account you connected with that login, here or anywhere else in TapIt, will stop working until reconnected.';
  return 'This removes TapIt’s access for that Google account; any other TapIt connection made with it will need reconnecting.';
}

export function disconnectSummary(
  result: SocialPortalDisconnectResult,
  platform: string,
): string {
  const parts = ['Disconnected.'];
  if (result.cancelledScheduledPosts > 0)
    parts.push(
      `${result.cancelledScheduledPosts} scheduled ${result.cancelledScheduledPosts === 1 ? 'post was' : 'posts were'} cancelled.`,
    );
  if (result.revocationStatus === 'remove_access_in_platform_settings')
    parts.push(
      `We couldn’t remove access automatically — remove TapIt in your ${accessProviderName(platform)} account settings.`,
    );
  if (result.othersNeedReconnect > 0)
    parts.push(
      `${result.othersNeedReconnect} other ${result.othersNeedReconnect === 1 ? 'connection needs' : 'connections need'} reconnecting.`,
    );
  return parts.join(' ');
}

/** True when the social module is switched off for this client (a 403 that is not an auth problem). */
export function isModuleOff(cause: unknown): boolean {
  return (
    cause instanceof IdentityApiError &&
    cause.status === 403 &&
    cause.code !== 'CLIENT_PORTAL_FORBIDDEN' &&
    cause.code !== 'IDENTITY_SESSION_EXPIRED'
  );
}

export function platformLabel(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/** Whether the account is currently usable (not disconnected and not needing reconnection). */
export function isActiveAccount(account: Pick<SocialPortalAccount, 'status'>): boolean {
  return account.status === 'connected';
}

export function hasActiveAccount(overview: Pick<SocialPortalOverview, 'accounts'>): boolean {
  return overview.accounts.some(isActiveAccount);
}

export function accountStatusLabel(status: SocialPortalAccount['status']): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'reconnect_required':
      return 'Needs reconnecting';
    default:
      return 'Disconnected';
  }
}
