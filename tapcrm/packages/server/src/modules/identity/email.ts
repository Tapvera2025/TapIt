// Compatibility exports for callers that still import the legacy email module.
// New code should depend on the focused notification modules directly.
export { sendEmail, setEmailSender, resetEmailSender } from './notifications/mailer.js';
export type { EmailMessage, EmailSender } from './notifications/mailer.js';

export { sendAdminInvitation, sendEmployeeInvitation, sendEmployeeCredentials } from './notifications/invitation-email.js';
export type { AdminInvitationEmail } from './notifications/invitation-email.js';

export {
  sendPasswordResetEmail,
  sendEmailOtp,
  sendEmailVerification,
} from './notifications/authentication-email.js';

export {
  sendRecoveryCodeUsedAlert,
  sendSuspiciousLoginAlert,
  sendAccountLockedAlert,
  sendRefreshReuseAlert,
} from './notifications/security-email.js';

export { sendGeofenceDenialAlert, sendGeofenceConfigurationAlert } from './notifications/geofence-email.js';
