import { z } from 'zod';

/**
 * Environment configuration, validated at boot.
 *
 * Fails fast and loudly: a server that starts with a missing secret and
 * discovers it on the first request has turned a deployment error into an
 * incident. DP-3 — secrets come from a managed secret store; this module reads
 * whatever the platform injected, it never holds a default for one.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PG-3 — two distinct roles. The application role owns no tables and cannot
  // bypass RLS; the migration role owns them and never serves a request.
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  // DP-8 — pool size is budgeted, not guessed.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  REDIS_URL: z.string().url(),
  // ID-15a — application-level encryption key for geofence coordinates.
  IDENTITY_ENCRYPTION_KEY: z
    .string()
    .min(32, 'IDENTITY_ENCRYPTION_KEY must be at least 32 characters'),
  // ID-10 — optional trusted proxy country header / GeoIP integration.
  GEOIP_COUNTRY_HEADER: z.string().default('x-country-code'),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('tapcrm-files'),
  // FS-6 — statutory artifacts go to a write-once bucket with object lock.
  S3_BUCKET_WORM: z.string().default('tapcrm-worm'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  // ID-6 — access tokens are short-lived, default 60 minutes.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_PATH: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  //
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),

  SMTP_HOST: z.string().optional(),

  SMTP_PORT: z.coerce.number().int().positive().optional(),

  SMTP_SECURE: z.coerce.boolean().default(false),

  SMTP_USER: z.string().optional(),

  SMTP_PASSWORD: z.string().optional(),

  SMTP_FROM: z.string().email().optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only. */
export function __resetConfig(): void {
  cached = null;
}
