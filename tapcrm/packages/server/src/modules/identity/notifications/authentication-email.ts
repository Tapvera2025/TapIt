import { loadConfig } from '../../../config.js';
import { sendEmail } from './mailer.js';

export async function sendPasswordResetEmail(email: string, resetToken: string, organizationCode: string): Promise<void> {
  const config = loadConfig();
  const resetUrl = `${config.CORS_ORIGIN}/reset-password?token=${encodeURIComponent(resetToken)}&org=${encodeURIComponent(organizationCode)}`;
  await sendEmail({
    to: email,
    subject: 'TapCRM — Password Reset Request',
    text: ['You requested a password reset for your TapCRM account.', '', 'Click the link below to set a new password (valid for 30 minutes):', resetUrl, '', 'If you did not request this, please contact your administrator immediately.', 'Using this link will invalidate all your existing active sessions.'].join('\n'),
  });
}

export async function sendEmailOtp(email: string, otpCode: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM — Your Verification Code',
    text: [`Your single-use verification code is: ${otpCode}`, '', 'This code is valid for 10 minutes.', 'If you did not attempt to sign in, change your password immediately.'].join('\n'),
  });
}

export async function sendEmailVerification(email: string, verificationToken: string, organizationCode: string): Promise<void> {
  const config = loadConfig();
  const verifyUrl = `${config.CORS_ORIGIN}/verify-email?token=${encodeURIComponent(verificationToken)}&org=${encodeURIComponent(organizationCode)}`;
  await sendEmail({
    to: email,
    subject: 'TapCRM — Verify your email address',
    text: ['Welcome to TapCRM.', '', 'Please verify your email address using the link below:', verifyUrl, '', 'This verification link expires in 24 hours.', '', 'If you did not create this account, please ignore this email.'].join('\n'),
    html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;"><h2>Welcome to TapCRM</h2><p>Please verify your email address to activate your account.</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">Verify Email</a></p><p>This link expires in 24 hours.</p><p>If you did not create this account, you can ignore this email.</p></div>`,
  });
}
