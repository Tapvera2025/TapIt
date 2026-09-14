import { db } from '../../../platform/dal/db.js';
import { IdentityAuthenticationError } from '../errors.js';
import { verifyIdentityPassword } from '../password/service.js';
import { findUserByEmail } from '../repository.js';
import { createIdentitySession } from '../sessions/service.js';
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from '../security/brute-force.js';
import { detectSuspiciousLogin } from '../security/detection.js';
import { recordSecurityEvent } from '../security/events.js';
import { enforceGeofencedLogin } from '../geofence/service.js';
import { createIdentityContext } from './principal.js';
import { sql } from '../../../platform/dal/sql.js';

export async function login(input: { email: string; password: string; deviceLabel?: string; ip: string | null; userAgent: string | null; countryCode?: string | null; latitude?: number; longitude?: number; accuracyMetres?: number | null }) {
  await assertLoginAllowed(input.email, input.ip);
  const user = await findUserByEmail(input.email);
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new IdentityAuthenticationError('IDENTITY_ACCOUNT_LOCKED', undefined, 429);
  }
  if (!user || user.status !== 'active' || !user.passwordHash || !(await verifyIdentityPassword(user.passwordHash, input.password))) {
    const result = await recordLoginFailure(input.email, input.ip);
    if (result.accountLocked && user) {
      await db.transaction(createIdentityContext(user, `identity:lock:${user.id}`), (tx) => tx.query(sql`
        UPDATE app_user
        SET locked_until = now() + interval '15 minutes'
        WHERE organization_id = ${user.organizationId} AND id = ${user.id}
      `).then(() => undefined));
    }
    throw new IdentityAuthenticationError(result.locked ? 'IDENTITY_ACCOUNT_LOCKED' : 'IDENTITY_INVALID_CREDENTIALS', undefined, result.locked ? 429 : 401);
  }
  if (user.organizationStatus !== 'active') {
    throw new IdentityAuthenticationError('IDENTITY_ORGANIZATION_SUSPENDED');
  }
  if (user.lockedUntil) {
    await db.transaction(createIdentityContext(user, `identity:unlock-expired:${user.id}`), (tx) => tx.query(sql`
      UPDATE app_user SET locked_until = NULL
      WHERE organization_id = ${user.organizationId} AND id = ${user.id} AND locked_until <= now()
    `).then(() => undefined));
  }
  await clearLoginFailures(input.email, input.ip);
  if (user.geofenceRequired) await enforceGeofencedLogin({
    organizationId: user.organizationId,
    userId: user.id,
    accountType: user.accountType,
    user,
    ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
    ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
    ...(input.accuracyMetres === undefined ? {} : { accuracyMetres: input.accuracyMetres }),
    ip: input.ip,
  });
  const transactionResult = await db.transaction(createIdentityContext(user, `identity:login:${user.id}`), async (tx) => {
    const signals = await detectSuspiciousLogin(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      signals: { deviceLabel: input.deviceLabel ?? null, ip: input.ip, countryCode: input.countryCode ?? null },
    });
    const tokens = await createIdentitySession(tx, user, {
      deviceLabel: input.deviceLabel ?? null,
      ip: input.ip,
      userAgent: input.userAgent,
      countryCode: input.countryCode ?? null,
    });
    for (const signal of signals) {
      await recordSecurityEvent(tx, {
        organizationId: user.organizationId,
        event: signal.event,
        actorId: user.id,
        actorType: user.accountType,
        targetId: user.id,
        sessionId: tokens.sessionId,
        sourceIp: input.ip,
        countryCode: input.countryCode ?? null,
        metadata: signal.metadata,
      });
    }
    return tokens;
  });
  const { sessionId: _sessionId, ...tokens } = transactionResult;
  return {
    ...tokens,
    passwordChangeRequired: user.mustChangePassword,
    user: { id: user.id, email: user.email, fullName: user.fullName, organizationId: user.organizationId, accountType: user.accountType },
  };
}
