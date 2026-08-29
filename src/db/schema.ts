import { pgTable, text, timestamp, uuid, jsonb, integer } from 'drizzle-orm/pg-core';

/**
 * A single audit run against one target URL.
 * Kept deliberately small — this is the seed schema, extend as features land.
 */
export const audits = pgTable('audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  status: text('status', { enum: ['queued', 'running', 'complete', 'failed'] })
    .notNull()
    .default('queued'),
  score: integer('score'),
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Audit = typeof audits.$inferSelect;
export type NewAudit = typeof audits.$inferInsert;
