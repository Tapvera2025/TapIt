import type {
  SocialPortalConnectionChoice,
  SocialPortalDisconnectResult,
  SocialPortalOverview,
  SocialPortalPlatform,
} from '@tapcrm/contracts';
import { identityRequest } from '../../identity/api/authApi.js';

const base = (clientId: string): string =>
  `/api/social/portal/clients/${encodeURIComponent(clientId)}`;

export const getSocialConnections = (clientId: string): Promise<SocialPortalOverview> =>
  identityRequest<SocialPortalOverview>(`${base(clientId)}/connections`);

export const startSocialConnection = (
  clientId: string,
  platform: SocialPortalPlatform,
): Promise<{ authorizationUrl: string }> =>
  identityRequest<{ authorizationUrl: string }>(
    `${base(clientId)}/oauth/${platform}/start`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

export const completeSocialConnection = (
  clientId: string,
  platform: SocialPortalPlatform,
  code: string,
  state: string,
): Promise<SocialPortalConnectionChoice> =>
  identityRequest<SocialPortalConnectionChoice>(
    `${base(clientId)}/oauth/${platform}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    },
  );

export const selectSocialAccounts = (
  clientId: string,
  platform: SocialPortalPlatform,
  state: string,
  accountIds: string[],
): Promise<SocialPortalOverview> =>
  identityRequest<SocialPortalOverview>(`${base(clientId)}/oauth/${platform}/select`, {
    method: 'POST',
    body: JSON.stringify({ state, accountIds }),
  });

export const disconnectSocialAccount = (
  clientId: string,
  accountId: string,
  revokeGrant: boolean,
): Promise<SocialPortalDisconnectResult> =>
  identityRequest<SocialPortalDisconnectResult>(
    `${base(clientId)}/accounts/${encodeURIComponent(accountId)}`,
    { method: 'DELETE', body: JSON.stringify({ revokeGrant }) },
  );
