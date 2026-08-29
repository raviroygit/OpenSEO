import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DATABASE_URL } from '../lib/env';
import * as schema from './schema';

/**
 * A single pool per process. Next.js dev reloads modules, so the pool is
 * cached on globalThis to avoid exhausting Postgres connections on hot reload.
 */
const globalForDb = globalThis as unknown as { __openseoPool?: Pool };

const pool =
  globalForDb.__openseoPool ??
  new Pool({
    connectionString: DATABASE_URL,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
    // Fail fast when the database host is unreachable. Without this, a
    // connection attempt to a dead host hangs until the OS gives up, which
    // stalls health checks and request handlers alike.
    connectionTimeoutMillis: Number.parseInt(
      process.env.DATABASE_CONNECT_TIMEOUT_MS ?? '5000',
      10,
    ),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__openseoPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool, schema };
