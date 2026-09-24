export interface IdentityUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  accountType: string;
}

export interface IdentityLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  passwordChangeRequired: boolean;
  user: IdentityUser;
}

export interface GeolocationInput {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
}

export class IdentityApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

const ACCESS_KEY = 'tapcrm.identity.access';
const REFRESH_KEY = 'tapcrm.identity.refresh';
export const IDENTITY_EXPIRED_EVENT = 'tapcrm:identity-expired';
let refreshPromise: Promise<boolean> | null = null;

export function getIdentityAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function saveIdentityTokens(accessToken: string, refreshToken: string): void {
  sessionStorage.setItem(ACCESS_KEY, accessToken);
  sessionStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearIdentityTokens(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

function redirectToIdentityLogin(): void {
  clearIdentityTokens();
  window.dispatchEvent(new Event(IDENTITY_EXPIRED_EVENT));
  if (window.location.pathname !== '/login') {
    window.history.replaceState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

async function refreshIdentityTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/identity/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const body = (await response.json()) as { success?: boolean; data?: { accessToken: string; refreshToken: string } };
      if (!response.ok || !body.success || !body.data) return false;
      saveIdentityTokens(body.data.accessToken, body.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function identityRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getIdentityAccessToken();
  if (!token) {
    redirectToIdentityLogin();
    throw new IdentityApiError('Your login session has expired', 'IDENTITY_SESSION_EXPIRED', 401);
  }

  const request = async (accessToken: string): Promise<Response> => fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  let response = await request(token);
  if (response.status === 401) {
    if (await refreshIdentityTokens()) {
      response = await request(getIdentityAccessToken()!);
      if (response.status === 401) redirectToIdentityLogin();
    } else {
      redirectToIdentityLogin();
    }
  }

  const body = (await response.json()) as { success?: boolean; data?: T; message?: string; code?: string };
  if (response.status === 403 && body.message === 'Company access is suspended') {
    redirectToIdentityLogin();
  }
  if (!response.ok || !body.success || body.data === undefined) {
    throw new IdentityApiError(body.message ?? 'Identity request failed', body.code ?? 'IDENTITY_REQUEST_FAILED', response.status);
  }
  return body.data;
}

/** Authenticated non-JSON response for user-facing downloads. */
export async function identityDownload(path: string, init: RequestInit = {}): Promise<Blob> {
  const token = getIdentityAccessToken();
  if (!token) {
    redirectToIdentityLogin();
    throw new IdentityApiError('Your login session has expired', 'IDENTITY_SESSION_EXPIRED', 401);
  }
  const request = (accessToken: string) => fetch(path, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  let response = await request(token);
  if (response.status === 401 && await refreshIdentityTokens()) response = await request(getIdentityAccessToken()!);
  if (response.status === 401) redirectToIdentityLogin();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new IdentityApiError(body.message ?? 'Download failed', body.code ?? 'IDENTITY_REQUEST_FAILED', response.status);
  }
  return response.blob();
}

export async function identityLogout(): Promise<void> {
  const accessToken = getIdentityAccessToken();
  try {
    if (accessToken) {
      await fetch('/api/identity/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    }
  } finally {
    clearIdentityTokens();
  }
}

export async function identityLogin(email: string, password: string, location?: GeolocationInput): Promise<IdentityLoginResult> {
  const response = await fetch('/api/identity/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceLabel: 'Company Web', ...(location ?? {}) }),
  });
  const body = (await response.json()) as { success?: boolean; data?: IdentityLoginResult; message?: string; code?: string };
  if (!response.ok || !body.success || !body.data) throw new IdentityApiError(body.message ?? 'Company login failed', body.code ?? 'IDENTITY_LOGIN_FAILED', response.status);
  saveIdentityTokens(body.data.accessToken, body.data.refreshToken);
  return body.data;
}

export async function requestGeofenceAppeal(input: GeolocationInput & { reason: string }): Promise<string> {
  const data = await identityRequest<{ id: string }>('/api/identity/geofence/appeal', {
    method: 'POST', body: JSON.stringify(input),
  });
  return data.id;
}

export interface GeofenceNotice { retentionDays: number; locations: Array<{ id: string; name: string; radiusMetres: number; accuracyThresholdMetres: number }> }

export async function getGeofenceNotice(): Promise<GeofenceNotice> {
  return identityRequest<GeofenceNotice>('/api/identity/geofence/notice');
}

export async function changeTemporaryPassword(currentPassword: string, newPassword: string): Promise<void> {
  await identityRequest('/api/identity/password/change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await fetch('/api/identity/password/reset/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error('Unable to submit password reset request');
}

export async function resetPassword(token: string, organizationCode: string, password: string): Promise<void> {
  const response = await fetch('/api/identity/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, organizationCode, password }),
  });
  const body = (await response.json()) as { success?: boolean; message?: string };
  if (!response.ok || !body.success) throw new Error(body.message ?? 'Password reset failed');
}
