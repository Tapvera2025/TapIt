import {
  getIdentityAccessToken,
  identityApiPath,
  identityRequest,
} from '../identity/api/authApi.js';
import type {
  SocialAccount,
  SocialAnalytics,
  SocialCompanyConnection,
  SocialCompanyLocation,
  SocialCompanyPlatform,
  SocialClient,
  SocialClientPage,
  SocialMedia,
  SocialPlatform,
  SocialPost,
  SocialPostAction,
  SocialPostInput,
  SocialPostPage,
  SocialProvider,
  SocialSettings,
} from './types.js';

const workspace = (clientId: string) =>
  `/api/social/clients/${encodeURIComponent(clientId)}`;
export const listSocialClients = (search = '', page = 1) =>
  identityRequest<SocialClientPage>(
    `/api/social/clients?${new URLSearchParams({ search, page: String(page), pageSize: '100' })}`,
  );
export const getSocialClient = (clientId: string) =>
  identityRequest<SocialClient>(workspace(clientId));
export const listSocialProviders = () =>
  identityRequest<SocialProvider[]>('/api/social/providers');
export const listSocialAccounts = (clientId: string) =>
  identityRequest<SocialAccount[]>(`${workspace(clientId)}/accounts`);
export const getSocialSettings = (clientId: string) =>
  identityRequest<SocialSettings>(`${workspace(clientId)}/settings`);
export const updateSocialSettings = (clientId: string, input: SocialSettings) =>
  identityRequest<SocialSettings>(`${workspace(clientId)}/settings`, {
    method: 'PUT',
    body: JSON.stringify({
      timezone: input.timezone,
      approvalRequired: input.approvalRequired,
      clientReviewEnabled: input.clientReviewEnabled,
    }),
  });
export const startSocialConnection = (clientId: string, platform: SocialPlatform) =>
  identityRequest<{ authorizationUrl: string }>(
    `${workspace(clientId)}/oauth/${platform}/start`,
    { method: 'POST', body: '{}' },
  );
export interface SocialConnectionCandidate {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  profileImageUrl?: string;
  capabilities: SocialProvider['capabilities'];
  /** Another client already uses this account (it serves one client at a time), or
   * this client connected it itself from the client portal (`viaClientPortal`, no name). */
  assignedTo?: {
    clientName: string | null;
    viaCompany: boolean;
    viaClientPortal?: boolean;
  } | null;
}
export interface SocialConnectionChoice {
  state: string;
  /** How long the choice stays open after the platform authorized it. */
  expiresInMinutes?: number;
  candidates: SocialConnectionCandidate[];
}
export const completeSocialConnection = (
  clientId: string,
  platform: SocialPlatform,
  code: string,
  state: string,
) =>
  identityRequest<SocialConnectionChoice>(
    `${workspace(clientId)}/oauth/${platform}/complete`,
    { method: 'POST', body: JSON.stringify({ code, state }) },
  );
export const selectSocialAccounts = (
  clientId: string,
  platform: SocialPlatform,
  state: string,
  accountIds: string[],
) =>
  identityRequest<SocialAccount[]>(`${workspace(clientId)}/oauth/${platform}/select`, {
    method: 'POST',
    body: JSON.stringify({ state, accountIds }),
  });
export const disconnectSocialAccount = (
  clientId: string,
  accountId: string,
  revokeGrant = false,
) =>
  identityRequest<{
    disconnected: boolean;
    revocationStatus: string;
    /** Other connections the same revoked grant served, now waiting for a reconnect. */
    othersNeedReconnect?: number;
  }>(
    `${workspace(clientId)}/accounts/${encodeURIComponent(accountId)}`,
    { method: 'DELETE', body: JSON.stringify({ revokeGrant }) },
  );
const companyConnections = '/api/social/company-connections';
/** Company-wide sign-ins (Google, Facebook + Instagram, LinkedIn, YouTube), managed by company admins. */
export const listCompanyConnections = () =>
  identityRequest<SocialCompanyConnection[]>(companyConnections);
export const startCompanyConnection = (platform: SocialCompanyPlatform) =>
  identityRequest<{ authorizationUrl: string }>(
    `${companyConnections}/oauth/${platform}/start`,
    { method: 'POST', body: '{}' },
  );
export const completeCompanyConnection = (
  platform: SocialCompanyPlatform,
  code: string,
  state: string,
) =>
  identityRequest<SocialCompanyConnection>(
    `${companyConnections}/oauth/${platform}/complete`,
    { method: 'POST', body: JSON.stringify({ code, state }) },
  );
export const listCompanyLocations = (connectionId: string) =>
  identityRequest<SocialCompanyLocation[]>(
    `${companyConnections}/${encodeURIComponent(connectionId)}/locations`,
  );
export const syncCompanyConnection = (connectionId: string) =>
  identityRequest<SocialCompanyConnection>(
    `${companyConnections}/${encodeURIComponent(connectionId)}/sync`,
    { method: 'POST', body: '{}' },
  );
/** Assigns a location to a client, or unassigns it with `clientId` null. `move` takes it
 * from the client it is assigned to now, in one step. */
export const assignCompanyLocation = (
  connectionId: string,
  locationId: string,
  clientId: string | null,
  move = false,
) =>
  identityRequest<SocialCompanyLocation>(
    `${companyConnections}/${encodeURIComponent(connectionId)}/locations/${encodeURIComponent(locationId)}/client`,
    { method: 'PUT', body: JSON.stringify({ clientId, move }) },
  );
export const disconnectCompanyConnection = (connectionId: string, revokeGrant: boolean) =>
  identityRequest<{
    disconnected: boolean;
    revocationStatus: string;
    /** Other connections the same revoked grant served, now waiting for a reconnect. */
    othersNeedReconnect?: number;
  }>(
    `${companyConnections}/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE', body: JSON.stringify({ revokeGrant }) },
  );
export function listSocialPosts(
  clientId: string,
  query: Record<string, string> = {},
): Promise<SocialPostPage> {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  return identityRequest(`${workspace(clientId)}/posts?${params}`);
}
export const getSocialPost = (clientId: string, postId: string) =>
  identityRequest<SocialPost>(
    `${workspace(clientId)}/posts/${encodeURIComponent(postId)}`,
  );
export const saveSocialPost = (
  clientId: string,
  input: SocialPostInput,
  postId?: string,
) =>
  identityRequest<SocialPost>(
    `${workspace(clientId)}/posts${postId ? `/${encodeURIComponent(postId)}` : ''}`,
    { method: postId ? 'PATCH' : 'POST', body: JSON.stringify(input) },
  );
export function actOnSocialPost(
  clientId: string,
  postId: string,
  action: SocialPostAction,
  extra: { comment?: string; scheduledAt?: string } = {},
): Promise<SocialPost> {
  const path = `${workspace(clientId)}/posts/${encodeURIComponent(postId)}`;
  if (action === 'publish' || action === 'schedule')
    return identityRequest(`${path}/publish`, {
      method: 'POST',
      body: JSON.stringify(extra),
    });
  if (action === 'approve' || action === 'request_changes')
    return identityRequest(`${path}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision: action, comment: extra.comment }),
    });
  return identityRequest(`${path}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action, ...extra }),
  });
}
export const getSocialAnalytics = (clientId: string, from: string, to: string) =>
  identityRequest<SocialAnalytics>(
    `${workspace(clientId)}/analytics?${new URLSearchParams({ from, to })}`,
  );
export async function uploadSocialMedia(
  clientId: string,
  file: File,
): Promise<SocialMedia> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result.split(',')[1] ?? '')
        : reject(new Error('Unable to read file data.'));
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
  return identityRequest(`${workspace(clientId)}/media`, {
    method: 'POST',
    body: JSON.stringify({ name: file.name, mimeType: file.type, base64: data }),
  });
}

export const syncSocialAnalytics = (clientId: string, from: string, to: string) =>
  identityRequest<SocialAnalytics>(`${workspace(clientId)}/analytics/sync`, {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });

/** CSV export bypasses the JSON envelope — downloads the file as a blob. */
export async function downloadSocialAnalyticsCsv(
  clientId: string,
  from: string,
  to: string,
): Promise<void> {
  const token = getIdentityAccessToken();
  if (!token) throw new Error('Your session expired. Sign in again to export analytics.');
  const query = new URLSearchParams({ from, to });
  const response = await fetch(
    identityApiPath(`${workspace(clientId)}/analytics/export?${query}`),
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok)
    throw new Error(`Export failed (${response.status}). Try again or check permissions.`);
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? 'social-analytics.csv';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
