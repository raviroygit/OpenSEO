import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';
import { QUEUE_NAME } from './env';

export type AuditJob = {
  auditId: string;
  url: string;
};

/**
 * Producer-side queue handle, used by the web app to enqueue work.
 *
 * The worker deliberately does NOT import this module — it only needs a
 * connection and a Worker, and importing this would open a second, idle
 * Redis connection per worker process.
 */
const globalForQueue = globalThis as unknown as { __openseoQueue?: Queue<AuditJob> };

export const auditQueue: Queue<AuditJob> =
  globalForQueue.__openseoQueue ??
  new Queue<AuditJob>(QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800 },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForQueue.__openseoQueue = auditQueue;
}
