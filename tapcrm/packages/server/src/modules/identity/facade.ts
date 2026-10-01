/**
 * Identity's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `identity`;
 * `npm run ci` refuses any other cross-module import. Callers:
 *
 *   employee           IdentityConflictError, IdentityValidationError,
 *                      hashIdentityPassword, sendEmployeeCredentials
 *   access-management  userResource
 *   employee           userResource (PATCH /api/users/:id)
 *   biometric          sendBiometricDeviceAlert
 */
export { IdentityConflictError, IdentityNotFoundError, IdentityValidationError } from './errors.js';
export { hashIdentityPassword } from './password/service.js';
export { sendEmployeeCredentials } from './notifications/invitation-email.js';
export { userResource } from './security/unlock.js';
export { sendBiometricDeviceAlert } from './notifications/biometric-email.js';
export { resolvePrincipal } from './authentication/authenticate.js';
export { escapeHtml, sendEmail } from './notifications/mailer.js';
