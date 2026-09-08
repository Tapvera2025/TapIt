export interface ApiResult<T> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
  details?: unknown;
}

const ACCESS_KEY = 'tapcrm.platform.access';
const REFRESH_KEY = 'tapcrm.platform.refresh';
export const AUTH_EXPIRED_EVENT = 'tapcrm:auth-expired';

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_KEY);
}
export function saveTokens(access: string, refresh: string) {
  sessionStorage.setItem(ACCESS_KEY, access);
  sessionStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  const body = (await response.json()) as ApiResult<T>;
  if (
    response.status === 401 &&
    retry &&
    path !== '/platform/auth/login' &&
    path !== '/platform/auth/refresh'
  ) {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        const refreshed = await api<{ accessToken: string; refreshToken: string }>(
          '/platform/auth/refresh',
          { method: 'POST', body: JSON.stringify({ refreshToken }) },
          false,
        );
        saveTokens(refreshed.accessToken, refreshed.refreshToken);
        return api<T>(path, init, false);
      } catch (error) {
        clearTokens();
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        throw error;
      }
    }
    clearTokens();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!response.ok || !body.success)
    throw new Error(body.message ?? body.code ?? `HTTP ${response.status}`);
  return body.data as T;
}

export function updateOrganization<TResponse, TPayload extends object = object>(id: string, payload: TPayload) {
  return api<TResponse>(`/platform/organizations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
