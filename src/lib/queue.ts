import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';
import { QUEUE_NAME } from './env';

/**
 * Jobs on the audit queue:
 *   "audit"           — run the audit row `auditId` (created by the web app
 *                       when someone presses "Run audit").
 *   "scheduled-audit" — fired by a project's job scheduler; the worker
 *                       creates the audit row itself, then runs it.
 */
export type AuditJob = {
  projectId: string;
  auditId?: string;
};

/**
 * Producer-side queue handle, used by the web app to enqueue work and manage
 * schedules.
 *
 * The worker deliberately does NOT import this module — it only needs a
 * connection and a Worker, and importing this would open a second, idle
 * Redis connection per worker process.
 */
const globalForQueue = globalThis as unknown as { __openseoQueue?: Queue<AuditJob> };

/**
 * Created on first use, not at import: `next build` evaluates route modules
 * that import this file, and must not open a Redis connection while doing so.
 * One instance per process (cached on globalThis across dev hot reloads).
 */
export function getAuditQueue(): Queue<AuditJob> {
  globalForQueue.__openseoQueue ??= new Queue<AuditJob>(QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      // A crawl that failed half-way is retried once; repeated failures are
      // the site's problem and are recorded on the audit instead.
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800 },
    },
  });
  return globalForQueue.__openseoQueue;
}

/** Spread scheduled crawls over 02:00–05:59 UTC so they don't all start at once. */
function cronFor(projectId: string, schedule: 'daily' | 'weekly'): string {
  let hash = 0;
  for (const ch of projectId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const minute = hash % 60;
  const hour = 2 + (hash % 4);
  return schedule === 'daily' ? `${minute} ${hour} * * *` : `${minute} ${hour} * * 1`;
}

/**
 * Keeps the project's BullMQ job scheduler in step with its schedule setting.
 * Idempotent: call it after every create / update; "off" removes it.
 */
export async function syncProjectSchedule(project: {
  id: string;
  schedule: 'off' | 'daily' | 'weekly';
}): Promise<void> {
  const key = `project-${project.id}`;
  if (project.schedule === 'off') {
    await getAuditQueue().removeJobScheduler(key);
    return;
  }
  await getAuditQueue().upsertJobScheduler(
    key,
    { pattern: cronFor(project.id, project.schedule), tz: 'UTC' },
    { name: 'scheduled-audit', data: { projectId: project.id } },
  );
}

export async function removeProjectSchedule(projectId: string): Promise<void> {
  await getAuditQueue().removeJobScheduler(`project-${projectId}`);
}
