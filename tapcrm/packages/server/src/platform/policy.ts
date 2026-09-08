import { PlatformForbiddenError } from './errors.js';
import type { PlatformRequestContext } from './auth/context.js';

export function requireMasterAdmin(ctx: PlatformRequestContext): void {
  if (ctx.principal.role !== 'MASTER_ADMIN') throw new PlatformForbiddenError();
}
