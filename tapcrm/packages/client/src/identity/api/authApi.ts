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
  user: IdentityUser;
}

const ACCESS_KEY = 'tapcrm.identity.access';
const REFRESH_KEY = 'tapcrm.identity.refresh';

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

export async function identityLogin(email: string, password: string): Promise<IdentityLoginResult> {
  const response = await fetch('/api/identity/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceLabel: 'Company Web' }),
  });
  const body = (await response.json()) as { success?: boolean; data?: IdentityLoginResult; message?: string };
  if (!response.ok || !body.success || !body.data) throw new Error(body.message ?? 'Company login failed');
  saveIdentityTokens(body.data.accessToken, body.data.refreshToken);
  return body.data;
}
