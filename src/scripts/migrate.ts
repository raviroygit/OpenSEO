import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';
import { DATABASE_URL } from '../lib/env';

/**
 * Applies pending SQL migrations from ./drizzle.
 *
 * Uses drizzle-orm's migrator rather than the drizzle-kit CLI, because
 * drizzle-kit is a devDependency and is deliberately absent from the runtime
 * images. Run this as a one-off task after a deploy — never automatically on
 * container start, where concurrent replicas would race each other.
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const db = drizzle(pool);

  // dist/scripts/migrate.js -> ../../drizzle
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');

  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] up to date');

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
