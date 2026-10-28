import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audits, projects } from '@/db/schema';
import { deleteProject, runAudit } from '@/app/actions';
import { AutoRefresh, ProjectSettingsForm } from '@/components/forms';
import { ConfirmButton } from '@/components/confirm-button';
import { IssueTotals, Score, StatusPill, ago, button, card, ghostButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) notFound();

  const history = await db
    .select()
    .from(audits)
    .where(eq(audits.projectId, id))
    .orderBy(desc(audits.createdAt))
    .limit(30);
  const latestComplete = history.find((a) => a.status === 'complete');
  const inFlight = history.some((a) => a.status === 'queued' || a.status === 'running');
  const summary = latestComplete?.result;

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh active={inFlight} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300">
            ← Projects
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
          <a href={project.domain} target="_blank" rel="noreferrer" className="text-sm text-slate-400 hover:text-[var(--color-accent)]">
            {project.domain} ↗
          </a>
        </div>
        <form action={runAudit}>
          <input type="hidden" name="id" value={project.id} />
          <button type="submit" disabled={inFlight} className={button}>
            {inFlight ? 'Audit in progress…' : 'Run audit now'}
          </button>
        </form>
      </div>

      <section className={`${card} flex flex-wrap items-center gap-6 p-6`}>
        <Score label="Technical" value={latestComplete?.technicalScore} size="lg" />
        <Score label="GEO" value={latestComplete?.geoScore} size="lg" />
        <div className="flex min-w-[16rem] flex-1 flex-col gap-2 text-sm">
          {latestComplete ? (
            <>
              <IssueTotals counts={latestComplete.issueCounts} />
              <p className="text-slate-400">
                {latestComplete.pagesCrawled} pages crawled · {ago(latestComplete.finishedAt)} ·{' '}
                <Link href={`/audits/${latestComplete.id}`} className="text-[var(--color-accent)] hover:underline">
                  View full report →
                </Link>
              </p>
              {summary && (
                <ul className="mt-1 grid gap-x-6 gap-y-1 text-slate-400 sm:grid-cols-2">
                  <li>HTTPS: {summary.https ? 'yes' : 'no'}</li>
                  <li>robots.txt: {summary.robotsTxt ? 'found' : 'missing'}</li>
                  <li>Sitemap: {summary.sitemap ? 'found' : 'missing'}</li>
                  <li>llms.txt: {summary.llmsTxt ? 'found' : 'missing'}</li>
                  <li className="sm:col-span-2">
                    AI crawlers blocked: {summary.blockedAiBots.length ? summary.blockedAiBots.join(', ') : 'none'}
                  </li>
                </ul>
              )}
            </>
          ) : (
            <p className="text-slate-400">{inFlight ? 'The first audit is running — this page updates by itself.' : 'No completed audit yet.'}</p>
          )}
        </div>
      </section>

      <section className={card}>
        <h2 className="border-b border-slate-800 px-6 py-4 text-lg font-semibold">Audit history</h2>
        {history.length === 0 ? (
          <p className="px-6 py-5 text-sm text-slate-400">No audits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">When</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Tech</th>
                  <th className="px-3 py-3 font-medium">GEO</th>
                  <th className="px-3 py-3 font-medium">Pages</th>
                  <th className="px-3 py-3 font-medium">Issues</th>
                  <th className="px-6 py-3 font-medium">Trigger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {history.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3">
                      <Link href={`/audits/${a.id}`} className="hover:text-[var(--color-accent)]">
                        {new Date(a.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
                      </Link>
                    </td>
                    <td className="px-3 py-3"><StatusPill status={a.status} /></td>
                    <td className="px-3 py-3 tabular-nums">{a.technicalScore ?? '–'}</td>
                    <td className="px-3 py-3 tabular-nums">{a.geoScore ?? '–'}</td>
                    <td className="px-3 py-3 tabular-nums">{a.pagesCrawled ?? '–'}</td>
                    <td className="px-3 py-3"><IssueTotals counts={a.issueCounts} /></td>
                    <td className="px-6 py-3 text-slate-400">{a.trigger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${card} p-6`}>
        <h2 className="mb-4 text-lg font-semibold">Settings</h2>
        <ProjectSettingsForm project={project} />
      </section>

      <section className={`${card} flex flex-wrap items-center justify-between gap-4 border-rose-900/50 p-6`}>
        <div>
          <h2 className="font-semibold">Delete project</h2>
          <p className="text-sm text-slate-400">Removes the project, every audit and its schedule. This cannot be undone.</p>
        </div>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <ConfirmButton label="Delete project" confirmLabel="Yes, delete everything" className={ghostButton} />
        </form>
      </section>
    </div>
  );
}
