import { createHmac, randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(): string {
  let value = '';
  for (const byte of randomBytes(20)) value += BASE32[byte % BASE32.length];
  return value;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/=+$/u, '').toUpperCase();
  let bits = '';
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/u.test(code)) return false;
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 30_000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const data = Buffer.alloc(8);
    data.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac('sha1', key).update(data).digest();
    const start = digest[digest.length - 1]! & 0x0f;
    const value = (digest.readUInt32BE(start) & 0x7fffffff) % 1_000_000;
    if (String(value).padStart(6, '0') === code) return true;
  }
  return false;
}
