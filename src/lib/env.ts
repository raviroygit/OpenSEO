/**
 * Minimal runtime env validation — no dependency, fails fast and loudly.
 *
 * Anything required here must be present in the container or the process
 * exits at boot instead of failing later with a confusing stack trace.
 */

type EnvSpec = {
  required: readonly string[];
  optional?: Readonly<Record<string, string>>;
};

function read(spec: EnvSpec): Record<string, string> {
  const missing: string[] = [];
  const out: Record<string, string> = {};

  for (const key of spec.required) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
      continue;
    }
    out[key] = value;
  }

  for (const [key, fallback] of Object.entries(spec.optional ?? {})) {
    out[key] = process.env[key]?.trim() || fallback;
  }

  // `next build` evaluates route modules to collect page data, but runtime
  // secrets (DATABASE_URL, REDIS_URL) only exist in the running container —
  // never in the image build. Skip the check there; it still runs, and still
  // fails fast, the moment the real server or worker starts.
  if (missing.length > 0 && process.env.NEXT_PHASE === 'phase-production-build') {
    return out;
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `See .env.example for the full list.`,
    );
  }

  return out;
}

const env = read({
  required: ['DATABASE_URL', 'REDIS_URL'],
  optional: {
    NODE_ENV: 'production',
    APP_URL: 'http://localhost:3000',
    QUEUE_NAME: 'openseo-audits',
    WORKER_CONCURRENCY: '4',
  },
});

export const DATABASE_URL = env.DATABASE_URL;
export const REDIS_URL = env.REDIS_URL;
export const APP_URL = env.APP_URL;
export const QUEUE_NAME = env.QUEUE_NAME;
export const WORKER_CONCURRENCY = Number.parseInt(env.WORKER_CONCURRENCY, 10);
export const IS_PRODUCTION = env.NODE_ENV === 'production';
