export { sendEmail, setEmailSender, resetEmailSender } from './mailer.js';
export type { EmailMessage, EmailSender } from './mailer.js';
export { sendAdminInvitation, sendEmployeeInvitation } from './invitation-email.js';
export { sendPasswordResetEmail, sendEmailOtp, sendEmailVerification } from './authentication-email.js';
export { sendRecoveryCodeUsedAlert, sendSuspiciousLoginAlert, sendAccountLockedAlert, sendRefreshReuseAlert } from './security-email.js';
export { sendGeofenceDenialAlert } from './geofence-email.js';
