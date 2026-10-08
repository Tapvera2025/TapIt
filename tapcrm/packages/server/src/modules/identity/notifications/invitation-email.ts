import { loadConfig } from '../../../config.js';
import { escapeHtml, sendEmail } from './mailer.js';

export interface AdminInvitationEmail {
  readonly to: string;
  readonly organizationName: string;
  readonly invitationUrl: string;
  readonly expiresAt: Date;
}

export async function sendAdminInvitation(input: AdminInvitationEmail): Promise<void> {
  const config = loadConfig();
  const organizationName = escapeHtml(input.organizationName);
  const safeInvitationUrl = escapeHtml(input.invitationUrl);
  const safeOrigin = escapeHtml(config.CLIENT_ORIGIN);
  await sendEmail({
    to: input.to,
    subject: 'TapCRM — Company Admin Invitation',
    text: [
      `You have been invited to join ${input.organizationName} as the Company Admin.`,
      '', 'Create your account using the link below:', input.invitationUrl, '',
      `This invitation expires at ${input.expiresAt.toISOString()}.`, '',
      'If you were not expecting this invitation, you can safely ignore this message.',
    ].join('\n'),
    html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;"><h2>TapCRM Company Admin Invitation</h2><p>You have been invited to join <strong>${organizationName}</strong> as the Company Admin.</p><p><a href="${safeInvitationUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p><p>This invitation expires at ${input.expiresAt.toISOString()}.</p><p>If you were not expecting this invitation, you can ignore this email.</p><p style="font-size: 12px; color: #666;">${safeOrigin}</p></div>`,
  });
}

export interface EmployeeInvitationOptions {
  email: string;
  invitationToken: string;
  organizationCode: string;
  expiresHours?: number | undefined;
  fullName?: string | undefined;
}

export async function sendEmployeeInvitation(
  inputOrEmail: string | EmployeeInvitationOptions,
  invitationToken?: string,
  organizationCode?: string,
  expiresHours = 72,
  fullName?: string,
): Promise<string> {
  const input: EmployeeInvitationOptions =
    typeof inputOrEmail === 'string'
      ? {
          email: inputOrEmail,
          invitationToken: invitationToken!,
          organizationCode: organizationCode!,
          expiresHours,
          fullName,
        }
      : inputOrEmail;

  const config = loadConfig();
  const hours = input.expiresHours ?? 72;
  const url = `${config.CLIENT_ORIGIN}/employee/setup?token=${encodeURIComponent(input.invitationToken)}&org=${encodeURIComponent(input.organizationCode)}`;
  const safeUrl = escapeHtml(url);
  const safeName = input.fullName ? escapeHtml(input.fullName) : null;

  await sendEmail({
    to: input.email,
    subject: 'TapCRM — Employee Account Setup',
    text: [
      `Welcome to TapCRM${input.fullName ? `, ${input.fullName}` : ''}.`,
      '',
      'Your employee account has been created.',
      'Please configure your permanent password using the secure link below:',
      url,
      '',
      `This setup link expires in ${hours} hours and can only be used once.`,
      'If you were not expecting this invitation, contact your administrator.',
    ].join('\n'),
    html: [
      '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">',
      '<h2>Welcome to TapCRM</h2>',
      `<p>${safeName ? `Hello <strong>${safeName}</strong>, your` : 'Your'} employee account has been created.</p>`,
      '<p>Please choose your permanent password to complete your account setup:</p>',
      `<p><a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Set Up Password</a></p>`,
      `<p style="font-size: 13px; color: #64748b;">This link is single-use and will expire in ${hours} hours.</p>`,
      '<p style="font-size: 12px; color: #94a3b8;">If you were not expecting this invitation, you can safely ignore this email.</p>',
      '</div>',
    ].join(''),
  });

  return url;
}

export async function sendEmployeeCredentials(input: { to: string; fullName: string; initialPassword: string }): Promise<void> {
  const config = loadConfig();
  const loginUrl = `${config.CLIENT_ORIGIN}/login`;
  const safeName = escapeHtml(input.fullName);
  const safeEmail = escapeHtml(input.to);
  const safePassword = escapeHtml(input.initialPassword);
  await sendEmail({
    to: input.to,
    subject: 'TapCRM — Your employee account credentials',
    text: [
      `Welcome to TapCRM, ${input.fullName}.`, '',
      `Login URL: ${loginUrl}`,
      `Email: ${input.to}`,
      `Initial Password: ${input.initialPassword}`, '',
      'This is a temporary password. You will be required to change it after your first login.',
      'If you were not expecting this account, contact your organization administrator.',
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Welcome to TapCRM</h2><p>Your employee account is ready, ${safeName}.</p><p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a><br><strong>Email:</strong> ${safeEmail}<br><strong>Initial Password:</strong> ${safePassword}</p><p>This is an initial password. You will be required to change it after your first login.</p></div>`,
    sensitive: true,
  });
}
