import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEEP_CHECK_TIMEOUT_MS = 5_000;

/**
 * Bounds a dependency check so an unreachable host cannot stall the response.
 * A hanging probe is worse than a failing one: monitors time out instead of
 * being told what is actually wrong.
 */
async function withTimeout<T>(label: string, work: () => Promise<T>): Promise<'ok' | string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} check timed out after ${DEEP_CHECK_TIMEOUT_MS}ms`)),
          DEEP_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 'unknown error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Liveness probe used by the Docker HEALTHCHECK and by Coolify.
 *
 * Deliberately does NOT touch Postgres or Redis: a transient database blip
 * should not cause the orchestrator to kill an otherwise healthy web
 * container. Use /api/health?deep=1 for a dependency check.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const deep = new URL(request.url).searchParams.get('deep') === '1';

  if (!deep) {
    return NextResponse.json({ status: 'ok', uptime: process.uptime() });
  }

  const checks: Record<string, 'ok' | string> = {};

  checks.postgres = await withTimeout('postgres', async () => {
    const { pool } = await import('@/db');
    await pool.query('SELECT 1');
  });

  checks.redis = await withTimeout('redis', async () => {
    const { createRedisConnection } = await import('@/lib/redis');
    const redis = createRedisConnection();
    try {
      await redis.ping();
    } finally {
      redis.disconnect();
    }
  });

  const healthy = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  );
}
