import { loadConfig } from '../../../config.js';
import nodemailer from 'nodemailer';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Sensitive bodies must never be printed by the development console sender. */
  readonly sensitive?: boolean;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const config = loadConfig();
    if (config.NODE_ENV === 'test') return;

    console.log('\n--- [EMAIL SENT - CONSOLE] ---');
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(message.sensitive ? 'Body: [sensitive content omitted]' : `Body:\n${message.text}`);
    console.log('------------------------------\n');
  }
}

class SmtpEmailSender implements EmailSender {
  private readonly transporter;

  constructor() {
    const config = loadConfig();
    if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_USER || !config.SMTP_PASSWORD)
      throw new Error('SMTP configuration is incomplete');
    // A made-up fallback sender would send real mail from an address nobody owns.
    if (!config.SMTP_FROM?.trim())
      throw new Error('SMTP_FROM is required when SMTP is configured');

    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    const config = loadConfig();
    await this.transporter.sendMail({
      from: config.SMTP_FROM?.trim(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

let customSender: EmailSender | null = null;
let smtpSender: SmtpEmailSender | null = null;

function hasSmtpConfig(): boolean {
  const config = loadConfig();
  return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_USER && config.SMTP_PASSWORD);
}

function getSmtpSender(): SmtpEmailSender {
  smtpSender ??= new SmtpEmailSender();
  return smtpSender;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

export function setEmailSender(sender: EmailSender): void {
  customSender = sender;
}

export function resetEmailSender(): void {
  customSender = null;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = loadConfig();
  if (customSender) {
    await customSender.send(message);
    return;
  }

  if (config.NODE_ENV === 'test' || !hasSmtpConfig()) {
    await new ConsoleEmailSender().send(message);
    return;
  }

  if (config.NODE_ENV === 'development') {
    await new ConsoleEmailSender().send(message);
    await getSmtpSender().send(message);
    return;
  }

  await getSmtpSender().send(message);
}
