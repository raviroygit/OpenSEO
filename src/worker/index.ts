import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createRedisConnection } from '../lib/redis';
import type { AuditJob } from '../lib/queue';
import { QUEUE_NAME, WORKER_CONCURRENCY } from '../lib/env';
import { db, pool } from '../db';
import { auditIssues, auditPages, audits, projects, type Audit } from '../db/schema';
import { crawlSite } from './crawler';
import { analyse } from './checks';
import { maybeAlert } from './alerts';

const INSERT_BATCH = 500;

async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) await insert(rows.slice(i, i + INSERT_BATCH));
}

/** Crawl, check and score one audit row. Records failures on the row itself. */
async function runAudit(auditId: string): Promise<Audit | null> {
  const [row] = await db
    .select({ audit: audits, project: projects })
    .from(audits)
    .innerJoin(projects, eq(audits.projectId, projects.id))
    .where(eq(audits.id, auditId));
  if (!row) {
    console.warn(`[worker] audit ${auditId} no longer exists (project deleted?), skipping`);
    return null;
  }
  const { project } = row;
  console.log(`[worker] audit ${auditId}: crawling ${project.domain} (max ${project.maxPages} pages)`);

  await db
    .update(audits)
    .set({ status: 'running', startedAt: new Date(), error: null, updatedAt: new Date() })
    .where(eq(audits.id, auditId));

  try {
    const crawl = await crawlSite(project.domain, project.maxPages);
    const result = analyse(crawl);

    // A retried job must not double its pages/issues.
    await db.delete(auditPages).where(eq(auditPages.auditId, auditId));
    await db.delete(auditIssues).where(eq(auditIssues.auditId, auditId));
    await insertInBatches(
      crawl.pages.map((p) => ({
        auditId,
        url: p.url,
        statusCode: p.status,
        title: p.title?.slice(0, 500) ?? null,
        loadMs: p.loadMs,
        wordCount: p.wordCount,
        depth: p.depth,
      })),
      (batch) => db.insert(auditPages).values(batch),
    );
    await insertInBatches(
      result.issues.map((i) => ({ auditId, ...i })),
      (batch) => db.insert(auditIssues).values(batch),
    );

    const [done] = await db
      .update(audits)
      .set({
        status: 'complete',
        technicalScore: result.technicalScore,
        geoScore: result.geoScore,
        score: Math.round((result.technicalScore + result.geoScore) / 2),
        pagesCrawled: crawl.pages.length,
        issueCounts: result.counts,
        result: result.summary,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(audits.id, auditId))
      .returning();
    console.log(
      `[worker] audit ${auditId}: ${crawl.pages.length} pages, technical ${result.technicalScore}, GEO ${result.geoScore}`,
    );
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(audits)
      .set({ status: 'failed', error: message.slice(0, 1000), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(audits.id, auditId));
    console.error(`[worker] audit ${auditId} failed: ${message}`);
    return null;
  }
}

async function handle(job: Job<AuditJob>): Promise<void> {
  if (job.name === 'scheduled-audit') {
    const [project] = await db.select().from(projects).where(eq(projects.id, job.data.projectId));
    if (!project) return; // deleted; its scheduler is removed with it
    const [audit] = await db
      .insert(audits)
      .values({ projectId: project.id, url: project.domain, trigger: 'schedule' })
      .returning();
    const done = await runAudit(audit.id);
    if (done) await maybeAlert(project, done);
    return;
  }
  if (job.data.auditId) await runAudit(job.data.auditId);
}

const connection = createRedisConnection();

const worker = new Worker<AuditJob>(QUEUE_NAME, handle, {
  connection,
  concurrency: WORKER_CONCURRENCY,
  // A 100-page crawl can take minutes; keep the lock alive meanwhile.
  lockDuration: 120_000,
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
