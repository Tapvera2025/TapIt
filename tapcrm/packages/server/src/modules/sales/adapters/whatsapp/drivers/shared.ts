import { timingSafeEqual } from 'node:crypto';
import type { WebhookRequest } from '../driver.js';

/**
 * Simple shared-secret verification: a provider that doesn't offer HMAC
 * usually gives the integrator a static bearer token. Timing-safe
 * comparison so a prefix match never leaks.
 */
export function verifyBearer(req: WebhookRequest, secret: string): boolean {
  if (!secret) return false;
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (token.length === 0 || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(secret, 'utf8'));
}
