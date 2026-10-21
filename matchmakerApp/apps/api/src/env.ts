import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Environment, validated once at startup.
 *
 * Failing here rather than on the first request that happens to need a missing
 * variable: a server that boots with no `DATABASE_URL` and then answers 500s
 * is harder to diagnose than one that refuses to start and says what is wrong.
 */

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

// `process.loadEnvFile` is Node 20.12+. It throws if the file is absent, which
// is fine -- in a real deployment the variables come from the environment and
// there is no `.env` at all.
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    // Caught here because it is otherwise a "connection terminated
    // unexpectedly" from the driver, several stack frames from the cause.
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: 'DATABASE_URL must be a postgres:// connection string',
    }),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PASSWORD_PEPPER: z.string().default(''),
  // Signs access tokens. See `src/auth.ts`.
  //
  // Required in production, optional in development where a stable development
  // default keeps `npm run dev` working without setup. That asymmetry is
  // deliberate: a forgotten secret should be impossible to ship and merely
  // annoying locally.
  AUTH_SECRET: z.string().default('dev-only-insecure-secret'),

  /**
   * Comma-separated origins allowed to call this API from a browser.
   *
   * Needed because Expo's web dev server (`http://localhost:8081`) and the API
   * (`http://localhost:3001`) are different origins, and a browser enforces
   * that. Without these headers the preflight fails and every request dies as
   * `net::ERR_FAILED` before it is ever sent -- which is invisible to `curl`
   * and to the integration test, neither of which enforces CORS.
   *
   * An allowlist rather than `*`, for two reasons: any page the browser visits
   * could otherwise call a local API holding real profiles, and `*` is
   * *illegal* alongside credentials, so the day cookie sessions replace the
   * bearer token the whole thing would stop working.
   */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${detail}\n\nSee apps/api/.env.example.`);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  parsed.data.AUTH_SECRET === 'dev-only-insecure-secret'
) {
  throw new Error('AUTH_SECRET must be set to something else in production.');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';

/** `CORS_ORIGINS` as a set, trimmed, for the CORS middleware. */
export const corsOrigins: ReadonlySet<string> = new Set(
  env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
);
