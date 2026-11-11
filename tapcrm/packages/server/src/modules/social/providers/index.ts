import type { SocialCompanyPlatform } from '@tapcrm/contracts';
import { GoogleProvider } from './google.js';
import { LinkedInProvider } from './linkedin.js';
import { MetaProvider } from './meta.js';
import {
  ProviderError,
  SOCIAL_PLATFORMS,
  type ProviderConfig,
  type ProviderReadiness,
  type SocialPlatform,
  type SocialProvider,
} from './types.js';

export * from './types.js';

function configFor(platform: SocialPlatform): ProviderConfig {
  if (platform === 'facebook' || platform === 'instagram')
    return {
      clientId: process.env['SOCIAL_META_CLIENT_ID'] ?? '',
      clientSecret: process.env['SOCIAL_META_CLIENT_SECRET'] ?? '',
      apiVersion: process.env['SOCIAL_META_API_VERSION'] || 'v24.0',
    };
  if (platform === 'linkedin')
    return {
      clientId: process.env['SOCIAL_LINKEDIN_CLIENT_ID'] ?? '',
      clientSecret: process.env['SOCIAL_LINKEDIN_CLIENT_SECRET'] ?? '',
      apiVersion: process.env['SOCIAL_LINKEDIN_API_VERSION'] || '202609',
      organizationEnabled:
        process.env['SOCIAL_LINKEDIN_ORGANIZATIONS_ENABLED'] === 'true',
      insightsEnabled: process.env['SOCIAL_LINKEDIN_INSIGHTS_ENABLED'] === 'true',
    };
  return {
    clientId: process.env['SOCIAL_GOOGLE_CLIENT_ID'] ?? '',
    clientSecret: process.env['SOCIAL_GOOGLE_CLIENT_SECRET'] ?? '',
  };
}

function buildProvider(platform: SocialPlatform, config: ProviderConfig): SocialProvider {
  if (platform === 'facebook' || platform === 'instagram')
    return new MetaProvider(platform, config);
  if (platform === 'linkedin') return new LinkedInProvider(config);
  return new GoogleProvider(platform, config);
}

export function getProviderReadiness(platform: SocialPlatform): ProviderReadiness {
  const names = {
    facebook: 'Facebook Pages',
    instagram: 'Instagram Professional',
    linkedin: 'LinkedIn',
    google_business: 'Google Business Profile',
    youtube: 'YouTube',
  };
  const approvalVars = {
    facebook: 'SOCIAL_META_APPROVED',
    instagram: 'SOCIAL_META_APPROVED',
    linkedin: 'SOCIAL_LINKEDIN_APPROVED',
    google_business: 'SOCIAL_GOOGLE_BUSINESS_APPROVED',
    youtube: 'SOCIAL_YOUTUBE_APPROVED',
  };
  const config = configFor(platform);
  const capabilities = buildProvider(platform, config).capabilities;
  if (!config.clientId || !config.clientSecret)
    return {
      platform,
      name: names[platform],
      status: 'setup_required',
      message:
        'Configure the CRM developer application credentials and registered callback URI.',
      capabilities,
    };
  if (process.env[approvalVars[platform]] !== 'true')
    return {
      platform,
      name: names[platform],
      status: 'pending_approval',
      message:
        platform === 'linkedin'
          ? 'Enable Sign In with LinkedIn and Share on LinkedIn products. Organization access additionally requires Community Management approval. Confirm enabled products in server configuration.'
          : 'Confirm the required platform API approval and OAuth verification before enabling client connections.',
      capabilities,
    };
  return {
    platform,
    name: names[platform],
    status: 'ready',
    message:
      platform === 'linkedin' && !config.organizationEnabled
        ? 'Member publishing is configured. Organization publishing requires approved Community Management access and explicit enablement.'
        : 'Developer application is configured. Each client must grant access to their supported accounts.',
    capabilities,
  };
}

export function listProviderReadiness(): ProviderReadiness[] {
  return SOCIAL_PLATFORMS.map(getProviderReadiness);
}

function assertReady(platform: SocialPlatform): void {
  const readiness = getProviderReadiness(platform);
  if (readiness.status !== 'ready')
    throw new ProviderError(
      readiness.status === 'setup_required' ? 'SETUP_REQUIRED' : 'API_APPROVAL_REQUIRED',
      readiness.message,
    );
}

export function getProvider(platform: SocialPlatform): SocialProvider {
  if (!SOCIAL_PLATFORMS.includes(platform))
    throw new ProviderError(
      'PLATFORM_UNSUPPORTED',
      'Choose a supported social platform.',
    );
  assertReady(platform);
  return buildProvider(platform, configFor(platform));
}

/** The provider for a company-wide sign-in: one login that lists everything it manages.
 * A Meta sign-in lists the Pages and the Instagram accounts linked to them; a Google
 * sign-in also lists the Search Console properties it can read. Refreshing, revoking
 * and publishing use `getProvider`, which serves either kind of stored token. */
export function getCompanyProvider(platform: SocialCompanyPlatform): SocialProvider {
  assertReady(platform);
  const config = configFor(platform);
  if (platform === 'facebook')
    return new MetaProvider('facebook', config, { companyWide: true });
  if (platform === 'google_business')
    return new GoogleProvider('google_business', config, { searchConsole: true });
  return buildProvider(platform, config);
}
