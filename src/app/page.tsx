import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audits, projects, type Audit } from '@/db/schema';
import { AddProjectForm, AutoRefresh } from '@/components/forms';
import { IssueTotals, Score, StatusPill, ago, card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const [allProjects, latest, latestComplete] = await Promise.all([
    db.select().from(projects).orderBy(asc(projects.name)),
    // Newest audit of each project (for its status)…
    db.selectDistinctOn([audits.projectId]).from(audits).orderBy(audits.projectId, desc(audits.createdAt)),
    // …and the newest finished one (for its scores).
    db
      .selectDistinctOn([audits.projectId])
      .from(audits)
      .where(eq(audits.status, 'complete'))
      .orderBy(audits.projectId, desc(audits.createdAt)),
  ]);
  const latestBy = new Map<string, Audit>(latest.map((a) => [a.projectId, a]));
  const scoredBy = new Map<string, Audit>(latestComplete.map((a) => [a.projectId, a]));
  const anyActive = latest.some((a) => a.status === 'queued' || a.status === 'running');

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh active={anyActive} />
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-1 text-sm text-slate-400">
          One project per website. Each is crawled and checked for technical SEO and AI-search (GEO) readiness.
        </p>
      </div>

      {allProjects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {allProjects.map((p) => {
            const last = latestBy.get(p.id);
            const scored = scoredBy.get(p.id);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className={`${card} flex items-center gap-5 p-5 transition hover:border-slate-600`}>
                <div className="flex gap-2">
                  <Score label="Tech" value={scored?.technicalScore} />
                  <Score label="GEO" value={scored?.geoScore} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold">{p.name}</h2>
                    {last && <StatusPill status={last.status} />}
                  </div>
                  <p className="truncate text-sm text-slate-400">{p.domain}</p>
                  <div className="mt-2 text-xs text-slate-500">
                    {scored ? (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <IssueTotals counts={scored.issueCounts} />
                        <span>· audited {ago(scored.finishedAt)}</span>
                      </span>
                    ) : (
                      'No completed audit yet'
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <section className={`${card} p-6`}>
        <h2 className="mb-4 text-lg font-semibold">{allProjects.length ? 'Add another website' : 'Add your first website'}</h2>
        <AddProjectForm />
      </section>
    </div>
  );
}
