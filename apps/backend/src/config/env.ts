import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Everything the backend needs is validated here at boot: if a required value is
 * missing or malformed the process exits immediately with a readable error
 * instead of failing later at runtime (for example during a login attempt).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Optional, public identifier for distinguishing test and live health checks.
  HEALTH_ENVIRONMENT_LABEL: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters (openssl rand -hex 32)'),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().max(24 * 60).default(60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  /** Name shown in the `iss` claim. */
  JWT_ISSUER: z.string().default('kotalabs-crm'),
  JWT_AUDIENCE: z.string().default('kotalabs-crm-web'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z
    .union([z.literal('true'), z.literal('false'), z.string().regex(/^\d+$/)])
    .default('false'),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),

  // An independent 256-bit randomly generated owner key; never use a human password.
  OWNER_CONTROLS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  OWNER_CONTROL_KEY: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  OWNER_PASSWORD_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DEFAULT_COUNTRY_CODE: z.string().length(2).default('IN'),
  PASSWORD_CHANGE_NOTIFICATIONS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  CALL_EVENT_AUTO_CREATE_LEAD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CALL_EVENT_AUTO_LINK_LEAD: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
}).superRefine((value, ctx) => {
  if (value.OWNER_PASSWORD_LOGIN_ENABLED && !value.OWNER_CONTROLS_ENABLED) {
    ctx.addIssue({ code: 'custom', path: ['OWNER_PASSWORD_LOGIN_ENABLED'], message: 'Owner controls must be enabled before password login' });
  }
  if (value.OWNER_CONTROLS_ENABLED && !value.OWNER_CONTROL_KEY) {
    ctx.addIssue({ code: 'custom', path: ['OWNER_CONTROL_KEY'], message: 'OWNER_CONTROL_KEY is required when owner controls are enabled' });
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Parsed, de-duplicated list of allowed browser origins. */
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const trustProxy: boolean | number =
  env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : Number(env.TRUST_PROXY);
