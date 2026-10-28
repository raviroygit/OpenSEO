import nodemailer from 'nodemailer';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { auditIssues, audits, type Audit, type Project } from '../db/schema';
import { APP_URL } from '../lib/env';

const SCORE_DROP_THRESHOLD = 5;

/** SMTP is optional: without it, alerts are logged and skipped. */
function transport() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number.parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });
}

async function criticalCodes(auditId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ code: auditIssues.code })
    .from(auditIssues)
    .where(and(eq(auditIssues.auditId, auditId), eq(auditIssues.severity, 'critical')));
  return new Set(rows.map((r) => r.code));
}

/**
 * After a scheduled audit: email the project's alert address when a score
 * fell by SCORE_DROP_THRESHOLD or more, or a critical issue appeared that the
 * previous complete audit didn't have. The first audit of a project only sets
 * the baseline.
 */
export async function maybeAlert(project: Project, current: Audit): Promise<void> {
  if (!project.alertEmail || current.status !== 'complete') return;

  const [previous] = await db
    .select()
    .from(audits)
    .where(and(eq(audits.projectId, project.id), eq(audits.status, 'complete'), ne(audits.id, current.id)))
    .orderBy(desc(audits.createdAt))
    .limit(1);
  if (!previous) return;

  const reasons: string[] = [];
  const drop = (label: string, before: number | null, after: number | null) => {
    if (before !== null && after !== null && before - after >= SCORE_DROP_THRESHOLD) {
      reasons.push(`${label} score dropped ${before} → ${after}`);
    }
  };
  drop('Technical', previous.technicalScore, current.technicalScore);
  drop('GEO', previous.geoScore, current.geoScore);

  const [now, before] = await Promise.all([criticalCodes(current.id), criticalCodes(previous.id)]);
  const newCritical = [...now].filter((c) => !before.has(c));
  if (newCritical.length) reasons.push(`New critical issue(s): ${newCritical.join(', ')}`);

  if (!reasons.length) return;

  const link = `${APP_URL}/audits/${current.id}`;
  const subject = `OpenSEO: ${project.name} needs attention`;
  const text = [
    `The scheduled audit of ${project.domain} found changes worth a look:`,
    '',
    ...reasons.map((r) => `• ${r}`),
    '',
    `Scores now: technical ${current.technicalScore ?? '–'}, GEO ${current.geoScore ?? '–'}.`,
    `Full report: ${link}`,
  ].join('\n');

  const mailer = transport();
  if (!mailer) {
    console.warn(`[alerts] SMTP not configured; would have emailed ${project.alertEmail}: ${reasons.join('; ')}`);
    return;
  }
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: project.alertEmail,
      subject,
      text,
    });
    console.log(`[alerts] emailed ${project.alertEmail} about ${project.domain}`);
  } catch (err) {
    console.error('[alerts] send failed:', err instanceof Error ? err.message : err);
  }
}
