import { z } from 'zod';

/**
 * Environment configuration, validated at boot.
 *
 * Fails fast and loudly: a server that starts with a missing secret and
 * discovers it on the first request has turned a deployment error into an
 * incident. DP-3 — secrets come from a managed secret store; this module reads
 * whatever the platform injected, it never holds a default for one.
 */

/**
 * `z.coerce.boolean()` is `Boolean(value)`, so the STRING "false" parses as true.
 * That silently enabled the header-trusting dev bypass and selected implicit TLS
 * for SMTP whenever an operator wrote `=false`. Booleans are parsed explicitly:
 * an empty value counts as unset, and anything unrecognised is a startup error.
 */
const envBoolean = (fallback: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalised = value.trim().toLowerCase();
    if (normalised === '') return undefined;
    if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
    if (['false', '0', 'no', 'off'].includes(normalised)) return false;
    return value;
  }, z.boolean({ invalid_type_error: 'must be true or false' }).default(fallback));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  IDENTITY_DEV_BYPASS: envBoolean(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PG-3 — two distinct roles. The application role owns no tables and cannot
  // bypass RLS; the migration role owns them and never serves a request.
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  // DP-8 — pool size is budgeted, not guessed.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  REDIS_URL: z.string().url(),
  // ID-9 / SE-5 — brute-force counters and rate limits must be shared across
  // replicas and survive a deploy. `memory` is a single-process fallback for
  // local work only, and is refused in production at boot.
  SECURITY_COUNTER_STORE: z.enum(['redis', 'memory']).default('redis'),
  // Optional header written by a trusted edge IP-geolocation provider. Empty
  // means country signals remain unavailable rather than client-controlled.
  TRUSTED_IP_COUNTRY_HEADER: z.string().trim().default(''),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('tapcrm-files'),
  // FS-6 — statutory artifacts go to a write-once bucket with object lock.
  S3_BUCKET_WORM: z.string().default('tapcrm-worm'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: envBoolean(true),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  // ID-6 — access tokens are short-lived, default 60 minutes.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),

  // §9.5.1 — the audit writer. A string enum rather than z.coerce.boolean(),
  // which would read the string "false" as true.
  AUDIT_DRAINER_ENABLED: z.enum(['true', 'false']).default('true'),
  AUDIT_DRAIN_INTERVAL_MS: z.coerce.number().int().min(100).default(5_000),
  AUDIT_DRAIN_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(200),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_PATH: z.string().default('/api'),
  // Not enforced today: there is no CORS middleware, and the web app reaches the
  // API same-origin through its dev proxy. Emailed links use CLIENT_ORIGIN.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // 
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.union([z.string().email(), z.literal('')]).optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

/** Values that ship in the repository, so anyone can know them. */
const PLACEHOLDER_SECRET = /^(replace-me|changeme|change-me|tapcrm_local)/i;

/**
 * Settings that are tolerable on a laptop and dangerous in production. Checked
 * only there, so local development keeps working on generated values.
 */
function productionProblems(config: Config, env: NodeJS.ProcessEnv): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (PLACEHOLDER_SECRET.test(config[key])) {
      problems.push(`${key} is a placeholder value published in the repository`);
    }
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  if (!env['CLIENT_ORIGIN']) {
    problems.push('CLIENT_ORIGIN must be set; it is the base of every emailed link');
  }
  if (config.SECURITY_COUNTER_STORE === 'memory') {
    problems.push('SECURITY_COUNTER_STORE=memory is single-process; use redis (ID-9, SE-5)');
  }
  return problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const problems = productionProblems(parsed.data, env);
  if (problems.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n${problems.map((p) => `  ${p}`).join('\n')}\n\nSee .env.example.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test-only. */
export function __resetConfig(): void {
  cached = null;
}
