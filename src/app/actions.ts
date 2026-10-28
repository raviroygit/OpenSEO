'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { audits, projects } from '@/db/schema';
import { normaliseDomain } from '@/lib/url';
import { getAuditQueue, removeProjectSchedule, syncProjectSchedule } from '@/lib/queue';

export type FormState = { error?: string };

const SCHEDULES = ['off', 'daily', 'weekly'] as const;
type Schedule = (typeof SCHEDULES)[number];

function readSchedule(v: FormDataEntryValue | null): Schedule {
  return SCHEDULES.includes(v as Schedule) ? (v as Schedule) : 'weekly';
}

function readMaxPages(v: FormDataEntryValue | null): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(1000, Math.max(5, n));
}

function readEmail(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('Alert email is not a valid address.');
  return s;
}

async function enqueueAudit(projectId: string, domain: string): Promise<string> {
  const [audit] = await db.insert(audits).values({ projectId, url: domain, trigger: 'manual' }).returning();
  await getAuditQueue().add('audit', { projectId, auditId: audit.id });
  return audit.id;
}

/** New project → first audit starts straight away, so there's something to look at. */
export async function createProject(_prev: FormState, form: FormData): Promise<FormState> {
  let projectId: string;
  try {
    const domain = normaliseDomain(String(form.get('domain') ?? ''));
    const name = String(form.get('name') ?? '').trim() || new URL(domain).hostname.replace(/^www\./, '');
    const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.domain, domain));
    if (existing.length) return { error: `${domain} is already a project.` };

    const [project] = await db
      .insert(projects)
      .values({
        name: name.slice(0, 100),
        domain,
        schedule: readSchedule(form.get('schedule')),
        maxPages: readMaxPages(form.get('maxPages')),
        alertEmail: readEmail(form.get('alertEmail')),
      })
      .returning();
    await syncProjectSchedule(project);
    await enqueueAudit(project.id, project.domain);
    projectId = project.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the project.' };
  }
  revalidatePath('/');
  redirect(`/projects/${projectId}`);
}

export async function updateProject(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id') ?? '');
  try {
    const name = String(form.get('name') ?? '').trim();
    if (!name) return { error: 'Name is required.' };
    const [project] = await db
      .update(projects)
      .set({
        name: name.slice(0, 100),
        schedule: readSchedule(form.get('schedule')),
        maxPages: readMaxPages(form.get('maxPages')),
        alertEmail: readEmail(form.get('alertEmail')),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    if (!project) return { error: 'Project not found.' };
    await syncProjectSchedule(project);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the project.' };
  }
  revalidatePath(`/projects/${id}`);
  revalidatePath('/');
  return {};
}

export async function runAudit(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) redirect('/');
  const auditId = await enqueueAudit(project.id, project.domain);
  revalidatePath(`/projects/${id}`);
  redirect(`/audits/${auditId}`);
}

/** Deletes the project, its audits, pages and issues (FK cascade) and its schedule. */
export async function deleteProject(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  await removeProjectSchedule(id);
  await db.delete(projects).where(eq(projects.id, id));
  revalidatePath('/');
  redirect('/');
}
