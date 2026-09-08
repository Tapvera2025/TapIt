const COMMON_BREACHED_PASSWORDS = new Set([
  'passwordpassword', '123456789012', '1234567890123456',
  'qwertyuiopasdf', 'letmeinletmein', 'welcome123456',
]);

export async function isBreachedPassword(password: string): Promise<boolean> {
  if (COMMON_BREACHED_PASSWORDS.has(password.toLowerCase())) return true;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const response = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'user-agent': 'TapCRM identity password policy' }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Password breach check is unavailable');
  const suffix = hex.slice(5);
  return (await response.text()).split('\n').some((line) => line.split(':', 1)[0]?.trim() === suffix);
}
