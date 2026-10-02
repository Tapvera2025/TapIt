const COMMON_BREACHED_PASSWORDS = new Set([
  'passwordpassword', '123456789012', '1234567890123456',
  'qwertyuiopasdf', 'letmeinletmein', 'welcome123456',
]);

export class PasswordBreachServiceError extends Error {
  constructor() {
    super('Password breach check is unavailable');
    this.name = 'PasswordBreachServiceError';
  }
}

/** The built-in list: checked always, even when the online check is off or down. */
export function isCommonPassword(password: string): boolean {
  return COMMON_BREACHED_PASSWORDS.has(password.toLowerCase());
}

export async function isBreachedPassword(password: string): Promise<boolean> {
  if (isCommonPassword(password)) return true;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  let response: Response;
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'user-agent': 'TapCRM identity password policy' }, signal: AbortSignal.timeout(3000) });
  } catch {
    throw new PasswordBreachServiceError();
  }
  if (!response.ok) throw new PasswordBreachServiceError();
  const suffix = hex.slice(5);
  return (await response.text()).split('\n').some((line) => line.split(':', 1)[0]?.trim() === suffix);
}
