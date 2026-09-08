import { sendEmail } from './mailer.js';

export async function sendRecoveryCodeUsedAlert(email: string, ip: string | null): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — MFA Recovery Code Used',
    text: ['A one-time MFA recovery code was used to sign in to your TapCRM account.', `Source IP: ${ip ?? 'Unknown'}`, `Time: ${new Date().toISOString()}`, '', 'If this was not you, your account may be compromised. Please revoke all sessions and change your credentials immediately.'].join('\n'),
  });
}

export async function sendSuspiciousLoginAlert(email: string, details: { ip: string | null; userAgent: string | null; approxLocation?: string | null }): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — New Sign-in Detected',
    text: ['A new sign-in was detected on your TapCRM account.', `IP: ${details.ip ?? 'Unknown'}`, `Device / User Agent: ${details.userAgent ?? 'Unknown'}`, `Location: ${details.approxLocation ?? 'Unknown'}`, `Time: ${new Date().toISOString()}`, '', 'If this was you, no action is needed.', 'If this was not you, please log in and revoke all active sessions under Settings > Sessions.'].join('\n'),
  });
}

export async function sendAccountLockedAlert(email: string, ip: string | null): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM Security Alert — Account Temporarily Locked',
    text: ['Your TapCRM account has been temporarily locked due to multiple failed sign-in attempts.', `Source IP: ${ip ?? 'Unknown'}`, `Time: ${new Date().toISOString()}`, '', 'Your account will automatically unlock after 15 minutes, or you may contact your Super Admin/HR to release the lock immediately.'].join('\n'),
  });
}

export async function sendRefreshReuseAlert(email: string, ip: string | null): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'TapCRM security alert — your session was ended',
    text: ['We ended one of your TapCRM sessions because an old sign-in token was used again.', '', `Source address: ${ip ?? 'unknown'}`, `Time: ${new Date().toISOString()}`, '', 'This usually means a browser or app retried an expired request, and no action is needed.', 'If you did not expect it, change your password and review your active devices in', 'Security settings.'].join('\n'),
  });
}
