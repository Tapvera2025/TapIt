import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async () => ({}));
const createTransport = vi.fn(() => ({ sendMail, verify: vi.fn(async () => true) }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { __resetConfig } = await import('../../config.js');
const { deliverEmail, __resetTransporter } = await import('./mailer.js');

const BASE = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  NODE_ENV: 'development',
};
const MESSAGE = { to: 'person@example.com', subject: 'Hello', text: 'Body' };

function useEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries({ ...BASE, ...values })) vi.stubEnv(key, value);
  __resetConfig();
  __resetTransporter();
}

describe('deliverEmail', () => {
  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetConfig();
    __resetTransporter();
  });

  it('prints instead of sending when no SMTP server is configured', async () => {
    useEnv({ SMTP_HOST: '', SMTP_FROM: '' });
    await deliverEmail(MESSAGE);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends with a login when SMTP_USER and SMTP_PASSWORD are set', async () => {
    useEnv({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_FROM: 'no-reply@example.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    await deliverEmail(MESSAGE);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', auth: { user: 'u', pass: 'p' } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'no-reply@example.com', to: MESSAGE.to }));
  });

  it('sends through a relay without a login when none is configured', async () => {
    useEnv({ SMTP_HOST: 'relay.office.lan', SMTP_PORT: '25', SMTP_FROM: 'no-reply@example.com' });
    await deliverEmail(MESSAGE);
    expect(createTransport).toHaveBeenCalledWith(expect.not.objectContaining({ auth: expect.anything() }));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not send when EMAIL_TRANSPORT=console even if SMTP is set', async () => {
    useEnv({ EMAIL_TRANSPORT: 'console', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_FROM: 'no-reply@example.com' });
    await deliverEmail(MESSAGE);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
