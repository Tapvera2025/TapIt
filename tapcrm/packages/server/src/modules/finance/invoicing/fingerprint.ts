import { createHash, randomBytes } from 'node:crypto';
function sorted(value: unknown): unknown { if(Array.isArray(value)) return value.map(sorted); if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,sorted((value as Record<string,unknown>)[key])])); return value; }
export function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex'); }
export function token(): string { return randomBytes(32).toString('base64url'); }
export function tokenHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
