import { describe, expect, it } from 'vitest';
import {
  clientPortalSocialUrl,
  connectedByLabel,
  isSocialProject,
  statusLabel,
} from './ClientSocialAccessCard.helpers.js';

describe('ClientSocialAccessCard helpers', () => {
  it('labels who connected an account', () => {
    expect(connectedByLabel({ connectionOrigin: 'client_portal' })).toBe('Connected by client');
    expect(connectedByLabel({ connectionOrigin: 'agency' })).toBe('Connected by your team');
  });
  it('labels statuses', () => {
    expect(statusLabel('connected')).toBe('Connected');
    expect(statusLabel('reconnect_required')).toBe('Reconnect needed');
    expect(statusLabel('disconnected')).toBe('Disconnected');
  });
  it('detects social projects by the smo service', () => {
    expect(isSocialProject({ services: [{ service: 'seo' }, { service: 'smo' }] })).toBe(true);
    expect(isSocialProject({ services: [{ service: 'seo' }] })).toBe(false);
  });
  it('builds the portal link', () => {
    expect(clientPortalSocialUrl('https://crm.example.com/')).toBe('https://crm.example.com/client/social');
  });
});
