import { db } from '../../../platform/dal/db.js';
import { IdentityAuthenticationError } from '../errors.js';
import { verifyIdentityPassword } from '../password/service.js';
import { findUserByEmail } from '../repository.js';
import { createIdentitySession } from '../sessions/service.js';
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from '../security/brute-force.js';
import { sendAccountLockedAlert, sendSuspiciousLoginAlert } from '../notifications/security-email.js';
import { enforceGeofencedLogin } from '../geofence/service.js';
import { createIdentityContext } from './principal.js';

export async function login(input: { email: string; password: string; deviceLabel?: string; ip: string | null; userAgent: string | null; latitude?: number; longitude?: number; accuracyMetres?: number | null }) {
  await assertLoginAllowed(input.email, input.ip);
  const user = await findUserByEmail(input.email);
  if (!user || user.status !== 'active' || !user.passwordHash || !(await verifyIdentityPassword(user.passwordHash, input.password))) {
    const result = await recordLoginFailure(input.email, input.ip);
    if (result.locked && user) {
      await db.transaction(createIdentityContext(user, `identity:lock:${user.id}`), (tx) => tx.query({ sql: 'UPDATE app_user SET status = \'locked\' WHERE organization_id = $1 AND id = $2', parameters: [user.organizationId, user.id] }).then(() => undefined));
      await sendAccountLockedAlert(user.email, input.ip);
    }
    throw new IdentityAuthenticationError('IDENTITY_INVALID_CREDENTIALS');
  }
  if (user.organizationStatus !== 'active') {
    throw new IdentityAuthenticationError('IDENTITY_ORGANIZATION_SUSPENDED');
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
  });
  const knownDevice = input.deviceLabel
    ? await db.transaction(createIdentityContext(user, `identity:device:${user.id}`), (tx) => tx.maybeOne<{ id: string }>({
        sql: 'SELECT id FROM session WHERE organization_id = $1 AND user_id = $2 AND device_label = $3 LIMIT 1',
        parameters: [user.organizationId, user.id, input.deviceLabel],
      }))
    : null;
  const tokens = await db.transaction(createIdentityContext(user, `identity:login:${user.id}`), (tx) => createIdentitySession(tx, user, { deviceLabel: input.deviceLabel ?? null, ip: input.ip, userAgent: input.userAgent }));
  if (!knownDevice && input.deviceLabel && input.deviceLabel !== 'unknown') await sendSuspiciousLoginAlert(user.email, { ip: input.ip, userAgent: input.userAgent, approxLocation: null });
  return { ...tokens, user: { id: user.id, email: user.email, fullName: user.fullName, organizationId: user.organizationId, accountType: user.accountType } };
}
