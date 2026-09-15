import { clearIdentityTokens, identityRequest } from './authApi.js';

export interface IdentitySession {
  id: string;
  deviceLabel: string | null;
  approxLocation: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return identityRequest<T>(path, init);
}

export function getMySessions(): Promise<IdentitySession[]> {
  return request<IdentitySession[]>('/api/identity/sessions');
}

export function revokeMySession(sessionId: string): Promise<{ revoked: boolean; current: boolean }> {
  return request(`/api/identity/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' });
}

export function revokeAllMySessions(): Promise<{ revoked: boolean; current: boolean }> {
  return request('/api/identity/sessions/revoke-all', { method: 'POST' });
}

export function signOutLocally(): void {
  clearIdentityTokens();
}
