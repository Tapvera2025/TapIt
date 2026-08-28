import { loadConfig } from '../../config.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const config = loadConfig();
    if (config.NODE_ENV !== 'test') {
      console.log(`\n--- [EMAIL SENT] ---`);
      console.log(`To: ${message.to}`);
      console.log(`Subject: ${message.subject}`);
      console.log(`Body: \n${message.text}`);
      console.log(`--------------------\n`);
    }
  }
}

let customSender: EmailSender | null = null;

export function setEmailSender(sender: EmailSender): void {
  customSender = sender;
}

export function resetEmailSender(): void {
  customSender = null;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const sender = customSender ?? new ConsoleEmailSender();
  await sender.send(message);
}

/**
 * ID-11: Password reset email (30-minute expiry)
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  organizationCode: string,
): Promise<void> {
  const config = loadConfig();
  const resetUrl = `${config.CORS_ORIGIN}/reset-password?token=${encodeURIComponent(resetToken)}&org=${encodeURIComponent(organizationCode)}`;

  await sendEmail({
    to: email,
    subject: 'TapCRM — Password Reset Request',
    text: [
      'You requested a password reset for your TapCRM account.',
      '',
      `Click the link below to set a new password (valid for 30 minutes):`,
      resetUrl,
      '',
      'If you did not request this, please contact your administrator immediately.',
      'Using this link will invalidate all your existing active sessions.',
    ].join('\n'),
  });
}

/**
 * ID-5b: Email OTP for MFA (Low assurance)
 */
export async function sendEmailOtp(email: string, otpCode: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM — Your Verification Code',
    text: [
      `Your single-use verification code is: ${otpCode}`,
      '',
      'This code is valid for 10 minutes.',
      'If you did not attempt to sign in, change your password immediately.',
    ].join('\n'),
  });
}

/**
 * ID-12: Email verification
 */
export async function sendEmailVerification(
  email: string,
  verificationToken: string,
  organizationCode: string,
): Promise<void> {
  const config = loadConfig();
  const verifyUrl = `${config.CORS_ORIGIN}/verify-email?token=${encodeURIComponent(verificationToken)}&org=${encodeURIComponent(organizationCode)}`;

  await sendEmail({
    to: email,
    subject: 'TapCRM — Verify your email address',
    text: [
      'Welcome to TapCRM.',
      '',
      `Please verify your email address by clicking the link below:`,
      verifyUrl,
      '',
      'Unverified accounts can sign in but cannot receive password reset links.',
    ].join('\n'),
  });
}

/**
 * ID-5c: Recovery code consumption notification
 */
export async function sendRecoveryCodeUsedAlert(
  email: string,
  ip: string | null,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — MFA Recovery Code Used',
    text: [
      'A one-time MFA recovery code was used to sign in to your TapCRM account.',
      `Source IP: ${ip ?? 'Unknown'}`,
      `Time: ${new Date().toISOString()}`,
      '',
      'If this was not you, your account may be compromised. Please revoke all sessions and change your credentials immediately.',
    ].join('\n'),
  });
}

/**
 * ID-10: Suspicious sign-in alert
 */
export async function sendSuspiciousLoginAlert(
  email: string,
  details: {
    ip: string | null;
    userAgent: string | null;
    approxLocation?: string | null;
  },
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — New Sign-in Detected',
    text: [
      'A new sign-in was detected on your TapCRM account.',
      `IP: ${details.ip ?? 'Unknown'}`,
      `Device / User Agent: ${details.userAgent ?? 'Unknown'}`,
      `Location: ${details.approxLocation ?? 'Unknown'}`,
      `Time: ${new Date().toISOString()}`,
      '',
      'If this was you, no action is needed.',
      'If this was not you, please log in and revoke all active sessions under Settings > Sessions.',
    ].join('\n'),
  });
}

/**
 * ID-15: Geofence denial alert
 */
export async function sendGeofenceDenialAlert(
  adminEmail: string,
  details: {
    userEmail: string;
    userName: string;
    distanceMeters: number;
    nearestLocationName: string;
    ip: string | null;
  },
): Promise<void> {
  await sendEmail({
    to: adminEmail,
    subject: 'TapCRM Alert — Geofence Access Violation',
    text: [
      `User ${details.userName} (${details.userEmail}) was denied sign-in due to geofencing policy.`,
      `Nearest assigned location: ${details.nearestLocationName}`,
      `Measured distance: ${Math.round(details.distanceMeters)} metres outside fence`,
      `IP: ${details.ip ?? 'Unknown'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n'),
  });
}

/**
 * ID-9: Account locked alert
 */
export async function sendAccountLockedAlert(
  email: string,
  ip: string | null,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — Account Temporarily Locked',
    text: [
      'Your TapCRM account has been temporarily locked due to multiple failed sign-in attempts.',
      `Source IP: ${ip ?? 'Unknown'}`,
      `Time: ${new Date().toISOString()}`,
      '',
      'Your account will automatically unlock after 15 minutes, or you may contact your Super Admin/HR to release the lock immediately.',
    ].join('\n'),
  });
}
