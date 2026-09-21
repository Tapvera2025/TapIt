import { describe, expect, it } from 'vitest';
import { loadConfig, __resetConfig } from './config.js';

const BASE = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

function load(overrides: Record<string, string | undefined> = {}) {
  __resetConfig();
  const env: NodeJS.ProcessEnv = { ...BASE };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    return loadConfig(env);
  } finally {
    __resetConfig();
  }
}

describe('environment booleans', () => {
  it('reads the string "false" as false (z.coerce.boolean() read it as true)', () => {
    const config = load({ IDENTITY_DEV_BYPASS: 'false', SMTP_SECURE: 'false', S3_FORCE_PATH_STYLE: 'false' });
    expect(config.IDENTITY_DEV_BYPASS).toBe(false);
    expect(config.SMTP_SECURE).toBe(false);
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on', ' true '])('reads %j as true', (value) => {
    expect(load({ IDENTITY_DEV_BYPASS: value }).IDENTITY_DEV_BYPASS).toBe(true);
  });

  it.each(['0', 'no', 'off', 'False'])('reads %j as false', (value) => {
    expect(load({ SMTP_SECURE: value }).SMTP_SECURE).toBe(false);
  });

  it('uses each setting\'s own default when unset or empty', () => {
    const config = load({ IDENTITY_DEV_BYPASS: '', SMTP_SECURE: undefined, S3_FORCE_PATH_STYLE: undefined });
    expect(config.IDENTITY_DEV_BYPASS).toBe(false);
    expect(config.SMTP_SECURE).toBe(false);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('rejects a value it does not recognise instead of guessing', () => {
    expect(() => load({ IDENTITY_DEV_BYPASS: 'maybe' })).toThrow(/IDENTITY_DEV_BYPASS/);
  });
});

describe('production safety', () => {
  const PROD = { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://crm.example.com' };

  it('accepts a properly configured production environment', () => {
    expect(() => load(PROD)).not.toThrow();
  });

  it('refuses the placeholder secrets that ship in the repository', () => {
    const placeholder = 'replace-me-in-every-real-environment';
    expect(() => load({ ...PROD, JWT_ACCESS_SECRET: placeholder })).toThrow(/JWT_ACCESS_SECRET is a placeholder/);
    expect(() => load({ ...PROD, JWT_REFRESH_SECRET: 'tapcrm_local_refresh_secret_please_change_32' })).toThrow(
      /JWT_REFRESH_SECRET is a placeholder/,
    );
  });

  it('refuses identical access and refresh secrets', () => {
    expect(() => load({ ...PROD, JWT_REFRESH_SECRET: BASE.JWT_ACCESS_SECRET })).toThrow(/must differ/);
  });

  it('requires CLIENT_ORIGIN to be set explicitly, not defaulted to localhost', () => {
    expect(() => load({ NODE_ENV: 'production' })).toThrow(/CLIENT_ORIGIN must be set/);
  });

  it('refuses the single-process security counter store', () => {
    expect(() => load({ ...PROD, SECURITY_COUNTER_STORE: 'memory' })).toThrow(/SECURITY_COUNTER_STORE/);
  });

  it('does not apply those rules in development', () => {
    expect(() => load({ JWT_ACCESS_SECRET: 'replace-me-in-every-real-environment'.padEnd(40, 'x') })).not.toThrow();
  });
});
