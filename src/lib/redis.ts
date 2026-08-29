import IORedis from 'ioredis';
import { REDIS_URL } from './env';

/**
 * BullMQ blocks on its connection, which requires maxRetriesPerRequest: null.
 * Both the producer (web) and the consumer (worker) build connections here.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
