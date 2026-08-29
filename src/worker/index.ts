import { Worker, type Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import type { AuditJob } from '../lib/queue';
import { QUEUE_NAME, WORKER_CONCURRENCY } from '../lib/env';
import { db } from '../db';
import { audits } from '../db/schema';
import { eq } from 'drizzle-orm';
import { pool } from '../db';

async function runAudit(job: Job<AuditJob>): Promise<void> {
  const { auditId, url } = job.data;
  console.log(`[worker] starting audit ${auditId} for ${url}`);

  await db
    .update(audits)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(audits.id, auditId));

  // Placeholder for the real crawl/analysis pipeline.
  const result = { url, checkedAt: new Date().toISOString() };

  await db
    .update(audits)
    .set({ status: 'complete', score: 0, result, updatedAt: new Date() })
    .where(eq(audits.id, auditId));

  console.log(`[worker] finished audit ${auditId}`);
}

const connection = createRedisConnection();

const worker = new Worker<AuditJob>(QUEUE_NAME, runAudit, {
  connection,
  concurrency: WORKER_CONCURRENCY,
});

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

worker.on('ready', () => {
  console.log(`[worker] listening on queue "${QUEUE_NAME}" (concurrency ${WORKER_CONCURRENCY})`);
});

/**
 * Coolify sends SIGTERM on redeploy. Drain in-flight jobs before exiting so a
 * deploy never leaves an audit stuck in "running".
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, draining...`);
  try {
    await worker.close();
    await connection.quit();
    await pool.end();
  } catch (err) {
    console.error('[worker] error during shutdown:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
