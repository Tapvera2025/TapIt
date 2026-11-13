import { describe, expect, it } from 'vitest';
import { IdentityApiError } from '../identity/api/authApi.js';
import {
  accountStatusLabel,
  disconnectSummary,
  hasActiveAccount,
  isModuleOff,
  parseOAuthFragment,
  platformLabel,
} from './social-connections-model.js';

const frag = (value: unknown): string =>
  `#social-oauth=${encodeURIComponent(JSON.stringify(value))}`;

describe('parseOAuthFragment', () => {
  it('ignores other hashes', () => {
    expect(parseOAuthFragment('#something')).toBeNull();
    expect(parseOAuthFragment('')).toBeNull();
  });
  it('reads a successful return', () => {
    expect(
      parseOAuthFragment(
        frag({
          code: 'c',
          state: 's',
          platform: 'facebook',
          scope: 'client',
          clientId: 'x',
        }),
      ),
    ).toEqual({
      kind: 'success',
      platform: 'facebook',
      code: 'c',
      state: 's',
      clientId: 'x',
    });
  });
  it('reads a denied return', () => {
    expect(
      parseOAuthFragment(
        frag({ error: 'SOCIAL_OAUTH_DENIED', message: 'No.', platform: 'youtube' }),
      ),
    ).toEqual({ kind: 'denied', message: 'No.' });
  });
  it('rejects incomplete or broken payloads', () => {
    expect(parseOAuthFragment(frag({ code: 'c', platform: 'facebook' }))?.kind).toBe(
      'invalid',
    );
    expect(
      parseOAuthFragment(
        frag({ code: 'c', state: 's', platform: 'linkedin', clientId: 'x' }),
      )?.kind,
    ).toBe('invalid');
    expect(parseOAuthFragment('#social-oauth=%7Bbad')?.kind).toBe('invalid');
  });
});

describe('disconnectSummary', () => {
  it('summarises the result', () => {
    expect(
      disconnectSummary(
        {
          disconnected: true,
          revocationStatus: 'remove_access_in_platform_settings',
          othersNeedReconnect: 2,
          cancelledScheduledPosts: 1,
        },
        'instagram',
      ),
    ).toBe(
      'Disconnected. 1 scheduled post was cancelled. We couldn’t remove access automatically — remove TapIt in your Facebook account settings. 2 other connections need reconnecting.',
    );
  });
});

describe('isModuleOff', () => {
  it('is true for a plain 403', () => {
    expect(isModuleOff(new IdentityApiError('no', 'SOCIAL_DISABLED', 403))).toBe(true);
  });
  it('is false for auth failures and other errors', () => {
    expect(isModuleOff(new IdentityApiError('no', 'CLIENT_PORTAL_FORBIDDEN', 403))).toBe(false);
    expect(isModuleOff(new IdentityApiError('no', 'IDENTITY_SESSION_EXPIRED', 403))).toBe(false);
    expect(isModuleOff(new IdentityApiError('no', 'X', 500))).toBe(false);
    expect(isModuleOff(new Error('x'))).toBe(false);
  });
});

describe('hasActiveAccount', () => {
  const acc = (status: 'connected' | 'reconnect_required' | 'disconnected') => ({ status });
  it('requires at least one connected account', () => {
    expect(hasActiveAccount({ accounts: [] })).toBe(false);
    expect(hasActiveAccount({ accounts: [acc('disconnected'), acc('reconnect_required')] } as never)).toBe(false);
    expect(hasActiveAccount({ accounts: [acc('disconnected'), acc('connected')] } as never)).toBe(true);
  });
});

describe('labels', () => {
  it('names platforms and statuses', () => {
    expect(platformLabel('youtube')).toBe('YouTube');
    expect(platformLabel('mystery')).toBe('mystery');
    expect(accountStatusLabel('reconnect_required')).toBe('Needs reconnecting');
  });
});
