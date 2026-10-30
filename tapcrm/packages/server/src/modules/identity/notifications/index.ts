export { sendEmail } from '../../../platform/email/index.js';
export type { EmailMessage } from '../../../platform/email/index.js';
export { sendAdminInvitation, sendEmployeeInvitation, sendEmployeeCredentials } from './invitation-email.js';
export { sendPasswordResetEmail, sendEmailOtp, sendEmailVerification } from './authentication-email.js';
export { sendRecoveryCodeUsedAlert, sendSuspiciousLoginAlert, sendAccountLockedAlert, sendRefreshReuseAlert } from './security-email.js';
export { sendGeofenceDenialAlert, sendGeofenceConfigurationAlert } from './geofence-email.js';
