import { pgTable, text, timestamp, uuid, jsonb, integer, index } from 'drizzle-orm/pg-core';

/**
 * One website being tracked. Everything else hangs off a project, so an
 * instance can watch any number of sites side by side.
 */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Normalised origin, e.g. "https://www.example.com" — no path, no slash. */
  domain: text('domain').notNull().unique(),
  /** Upper bound on pages fetched per audit. Keeps a crawl polite and bounded. */
  maxPages: integer('max_pages').notNull().default(100),
  schedule: text('schedule', { enum: ['off', 'daily', 'weekly'] })
    .notNull()
    .default('weekly'),
  /** Where score-drop / new-critical-issue alerts go. Null = no alerts. */
  alertEmail: text('alert_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A single audit run of one project: a crawl plus the technical and GEO
 * checks over every page it found.
 */
export const audits = pgTable(
  'audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Start URL of the crawl (the project's domain at the time). */
    url: text('url').notNull(),
    trigger: text('trigger', { enum: ['manual', 'schedule'] }).notNull().default('manual'),
    status: text('status', { enum: ['queued', 'running', 'complete', 'failed'] })
      .notNull()
      .default('queued'),
    /** Overall score: the mean of the technical and GEO scores. */
    score: integer('score'),
    technicalScore: integer('technical_score'),
    geoScore: integer('geo_score'),
    pagesCrawled: integer('pages_crawled'),
    /** Issue totals by severity, so lists don't need a join. */
    issueCounts: jsonb('issue_counts').$type<IssueCounts>(),
    /** Site-level facts: robots.txt, sitemap, llms.txt, AI-bot access, … */
    result: jsonb('result').$type<AuditSummary>(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audits_project_created_idx').on(t.projectId, t.createdAt)],
);

/** Every page fetched during an audit. */
export const auditPages = pgTable(
  'audit_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    statusCode: integer('status_code'),
    title: text('title'),
    loadMs: integer('load_ms'),
    wordCount: integer('word_count'),
    depth: integer('depth').notNull().default(0),
  },
  (t) => [index('audit_pages_audit_idx').on(t.auditId)],
);

/** One finding. Site-level findings have pageUrl = null. */
export const auditIssues = pgTable(
  'audit_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    pageUrl: text('page_url'),
    /** Stable machine code, e.g. "title-missing" — what alerts compare on. */
    code: text('code').notNull(),
    category: text('category', { enum: ['technical', 'geo'] }).notNull(),
    severity: text('severity', { enum: ['critical', 'warning', 'notice'] }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_issues_audit_idx').on(t.auditId)],
);

export type Severity = 'critical' | 'warning' | 'notice';
export type IssueCategory = 'technical' | 'geo';
export type IssueCounts = Record<Severity, number>;

export type AuditSummary = {
  finalUrl: string;
  https: boolean;
  robotsTxt: boolean;
  sitemap: string | null;
  llmsTxt: boolean;
  /** AI crawlers that robots.txt blocks from the whole site. */
  blockedAiBots: string[];
  pagesSkippedByRobots: number;
};

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Audit = typeof audits.$inferSelect;
export type NewAudit = typeof audits.$inferInsert;
export type AuditPage = typeof auditPages.$inferSelect;
export type AuditIssue = typeof auditIssues.$inferSelect;
