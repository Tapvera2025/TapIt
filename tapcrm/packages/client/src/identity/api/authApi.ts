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
  constructor(message: string, public readonly code: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

const ACCESS_KEY = 'tapcrm.identity.access';
const REFRESH_KEY = 'tapcrm.identity.refresh';
export const IDENTITY_EXPIRED_EVENT = 'tapcrm:identity-expired';
export const IDENTITY_SESSION_CHANGED_EVENT = 'tapcrm:identity-session-changed';
export const IDENTITY_BOOTSTRAP_UPDATED_EVENT = 'tapcrm:identity-bootstrap-updated';
export type IdentitySessionChangeReason = 'login' | 'refresh' | 'logout' | 'expired' | 'principal-changed' | 'permissions-changed';
export interface IdentitySessionSnapshot {
  readonly epoch: number;
  readonly principalId: string | null;
  readonly organizationId: string | null;
}
export interface IdentitySessionChangeDetail extends IdentitySessionSnapshot {
  readonly reason: IdentitySessionChangeReason;
}
let sessionEpoch = 0;
let principalId: string | null = null;
let organizationId: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const sessionListeners = new Set<(detail: IdentitySessionChangeDetail) => void>();

export function identityApiBasePath(): string {
  const configured = String(import.meta.env['VITE_API_BASE_PATH'] || '/api');
  return `/${configured.replace(/^\/+|\/+$/g, '')}`;
}

/** Existing callers use /api paths; deployments may mount the API elsewhere. */
export function identityApiPath(path: string): string {
  const suffix = path.replace(/^\/api(?=\/|$)/, '');
  return `${identityApiBasePath()}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function getIdentitySessionSnapshot(): IdentitySessionSnapshot {
  return { epoch: sessionEpoch, principalId, organizationId };
}

export function subscribeIdentitySessionChange(listener: (detail: IdentitySessionChangeDetail) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emitSessionChange(reason: IdentitySessionChangeReason): void {
  sessionEpoch += 1;
  const detail = { ...getIdentitySessionSnapshot(), reason };
  for (const listener of sessionListeners) listener(detail);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<IdentitySessionChangeDetail>(IDENTITY_SESSION_CHANGED_EVENT, {
      detail,
    }));
  }
}

export function setIdentitySessionPrincipal(nextPrincipalId: string, nextOrganizationId: string): void {
  if (principalId === nextPrincipalId && organizationId === nextOrganizationId) return;
  principalId = nextPrincipalId;
  organizationId = nextOrganizationId;
  emitSessionChange('principal-changed');
}

export function invalidateIdentityPermissions(): void {
  emitSessionChange('permissions-changed');
}

export function notifyIdentityBootstrapUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(IDENTITY_BOOTSTRAP_UPDATED_EVENT));
  }
}

export class IdentitySessionChangedError extends Error {
  constructor() {
    super('The signed-in account changed while the request was in progress');
    this.name = 'IdentitySessionChangedError';
  }
}

function assertSession(epoch: number): void {
  if (sessionEpoch !== epoch) throw new IdentitySessionChangedError();
}

export function getIdentityAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function saveIdentityTokens(accessToken: string, refreshToken: string, reason: 'login' | 'refresh' = 'login'): void {
  sessionStorage.setItem(ACCESS_KEY, accessToken);
  sessionStorage.setItem(REFRESH_KEY, refreshToken);
  if (reason === 'login') {
    principalId = null;
    organizationId = null;
  }
  emitSessionChange(reason);
}

export function clearIdentityTokens(reason: 'logout' | 'expired' = 'logout'): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  principalId = null;
  organizationId = null;
  emitSessionChange(reason);
}

function redirectToIdentityLogin(): void {
  clearIdentityTokens('expired');
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
  const expectedEpoch = sessionEpoch;
  refreshPromise = (async () => {
    try {
      const response = await fetch(identityApiPath('/api/identity/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return false;
      const body = (await response.json()) as { success?: boolean; data?: { accessToken: string; refreshToken: string } };
      if (!response.ok || !body.success || !body.data) return false;
      if (sessionEpoch !== expectedEpoch) return false;
      saveIdentityTokens(body.data.accessToken, body.data.refreshToken, 'refresh');
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
  let expectedEpoch = sessionEpoch;
  const expectedPrincipal = principalId;
  const expectedOrganization = organizationId;
  const token = getIdentityAccessToken();
  if (!token) {
    redirectToIdentityLogin();
    throw new IdentityApiError('Your login session has expired', 'IDENTITY_SESSION_EXPIRED', 401);
  }

  const request = async (accessToken: string): Promise<Response> => fetch(identityApiPath(path), {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  let response = await request(token);
  assertSession(expectedEpoch);
  if (response.status === 401) {
    if (await refreshIdentityTokens()) {
      if (sessionEpoch !== expectedEpoch + 1 || principalId !== expectedPrincipal || organizationId !== expectedOrganization) {
        throw new IdentitySessionChangedError();
      }
      expectedEpoch = sessionEpoch;
      response = await request(getIdentityAccessToken()!);
      assertSession(expectedEpoch);
      if (response.status === 401) redirectToIdentityLogin();
    } else {
      assertSession(expectedEpoch);
      redirectToIdentityLogin();
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  let body: { success?: boolean; data?: T; message?: string; code?: string; details?: unknown } | null = null;
  if (contentType.includes('application/json')) {
    try {
    body = (await response.json()) as { success?: boolean; data?: T; message?: string; code?: string; details?: unknown };
    } catch {
      body = null;
    }
  }

  assertSession(expectedEpoch);
  if (!body) {
    const errorText = await response.text().catch(() => '');
    const message = response.status === 404
      ? `Resource not found: ${path}`
      : `Server returned non-JSON response (${response.status}): ${response.statusText || errorText.slice(0, 100)}`;
    throw new IdentityApiError(message, response.status === 404 ? 'NOT_FOUND' : 'NON_JSON_RESPONSE', response.status);
  }
  if (response.status === 403 && body.message === 'Company access is suspended') {
    redirectToIdentityLogin();
  }
  if (!response.ok || !body.success || body.data === undefined) {
    throw new IdentityApiError(body.message ?? 'Identity request failed', body.code ?? 'IDENTITY_REQUEST_FAILED', response.status, body.details);
  }
  return body.data;
}

/** Authenticated non-JSON response for user-facing downloads. */
export async function identityDownload(path: string, init: RequestInit = {}): Promise<Blob> {
  let expectedEpoch = sessionEpoch;
  const expectedPrincipal = principalId;
  const expectedOrganization = organizationId;
  const token = getIdentityAccessToken();
  if (!token) {
    redirectToIdentityLogin();
    throw new IdentityApiError('Your login session has expired', 'IDENTITY_SESSION_EXPIRED', 401);
  }
  const request = (accessToken: string) => fetch(identityApiPath(path), {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  let response = await request(token);
  assertSession(expectedEpoch);
  if (response.status === 401 && await refreshIdentityTokens()) {
    if (sessionEpoch !== expectedEpoch + 1 || principalId !== expectedPrincipal || organizationId !== expectedOrganization) {
      throw new IdentitySessionChangedError();
    }
    expectedEpoch = sessionEpoch;
    response = await request(getIdentityAccessToken()!);
    assertSession(expectedEpoch);
  }
  assertSession(expectedEpoch);
  if (response.status === 401) redirectToIdentityLogin();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new IdentityApiError(body.message ?? 'Download failed', body.code ?? 'IDENTITY_REQUEST_FAILED', response.status);
  }
  const blob = await response.blob();
  assertSession(expectedEpoch);
  return blob;
}

export async function identityLogout(): Promise<void> {
  const accessToken = getIdentityAccessToken();
  clearIdentityTokens();
  try {
    if (accessToken) {
      await fetch(identityApiPath('/api/identity/logout'), {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    }
  } catch {
    // The local session has already ended; remote revocation is best effort.
  }
}

export async function identityLogin(email: string, password: string, location?: GeolocationInput): Promise<IdentityLoginResult> {
  const response = await fetch(identityApiPath('/api/identity/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceLabel: 'Company Web', ...(location ?? {}) }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new IdentityApiError('Server returned non-JSON response during login', 'NON_JSON_RESPONSE', response.status);
  }
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
  const response = await fetch(identityApiPath('/api/identity/password/reset/request'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error('Unable to submit password reset request');
}

export async function resetPassword(token: string, organizationCode: string, password: string): Promise<void> {
  const response = await fetch(identityApiPath('/api/identity/password/reset'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, organizationCode, password }),
  });
  const body = (await response.json()) as { success?: boolean; message?: string };
  if (!response.ok || !body.success) throw new Error(body.message ?? 'Password reset failed');
}

export interface EmployeeSetupVerification {
  valid: boolean;
  email: string;
  fullName: string;
  organizationName: string;
  organizationCode: string;
}

export async function verifyEmployeeSetupToken(
  token: string,
  organizationCode: string,
): Promise<EmployeeSetupVerification> {
  const params = new URLSearchParams({ token, organizationCode, org: organizationCode });
  const response = await fetch(
    `${identityApiPath('/api/identity/employee/setup/verify')}?${params.toString()}`,
  );
  const body = (await response.json()) as {
    success?: boolean;
    data?: EmployeeSetupVerification;
    message?: string;
    code?: string;
  };
  if (!response.ok || !body.success || !body.data) {
    const error = new Error(body.message ?? 'Invalid or expired setup link');
    if (body.code !== undefined) {
      (error as Error & { code?: string | undefined }).code = body.code;
    }
    throw error;
  }
  return body.data;
}

export async function setupEmployeePassword(
  token: string,
  organizationCode: string,
  password: string,
): Promise<{ email: string; fullName: string }> {
  const response = await fetch(identityApiPath('/api/identity/employee/setup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, organizationCode, org: organizationCode, password }),
  });
  const body = (await response.json()) as {
    success?: boolean;
    data?: { email: string; fullName: string };
    message?: string;
    code?: string;
  };
  if (!response.ok || !body.success || !body.data) {
    const error = new Error(body.message ?? 'Failed to set permanent password');
    if (body.code !== undefined) {
      (error as Error & { code?: string | undefined }).code = body.code;
    }
    throw error;
  }
  return body.data;
}
