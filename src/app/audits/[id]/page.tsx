import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditIssues, auditPages, audits, projects, type AuditIssue, type Severity } from '@/db/schema';
import { AutoRefresh } from '@/components/forms';
import { IssueTotals, Score, SeverityBadge, StatusPill, card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };
const TABS = [
  { key: 'all', label: 'All issues' },
  { key: 'technical', label: 'Technical' },
  { key: 'geo', label: 'GEO / AI search' },
] as const;

type Group = { code: string; severity: Severity; category: AuditIssue['category']; items: AuditIssue[] };

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { id } = await params;
  const { category = 'all' } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [row] = await db
    .select({ audit: audits, project: projects })
    .from(audits)
    .innerJoin(projects, eq(audits.projectId, projects.id))
    .where(eq(audits.id, id));
  if (!row) notFound();
  const { audit, project } = row;
  const active = audit.status === 'queued' || audit.status === 'running';

  const [issues, pages] = await Promise.all([
    db.select().from(auditIssues).where(eq(auditIssues.auditId, id)),
    db.select().from(auditPages).where(eq(auditPages.auditId, id)).orderBy(asc(auditPages.depth), asc(auditPages.url)),
  ]);

  const groups = new Map<string, Group>();
  for (const i of issues) {
    if (category !== 'all' && i.category !== category) continue;
    const g = groups.get(i.code) ?? { code: i.code, severity: i.severity, category: i.category, items: [] };
    g.items.push(i);
    groups.set(i.code, g);
  }
  const sorted = [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.items.length - a.items.length,
  );

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh active={active} />
      <div>
        <Link href={`/projects/${project.id}`} className="text-sm text-slate-500 hover:text-slate-300">
          ← {project.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Audit report</h1>
          <StatusPill status={audit.status} />
        </div>
        <p className="text-sm text-slate-400">
          {audit.url} · {new Date(audit.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC ·{' '}
          {audit.trigger}
        </p>
      </div>

      {active && (
        <p className={`${card} p-6 text-sm text-slate-300`}>
          Crawling {project.domain} (up to {project.maxPages} pages). This page refreshes by itself — it usually takes under a minute.
        </p>
      )}
      {audit.status === 'failed' && (
        <p className={`${card} border-rose-900/60 p-6 text-sm text-rose-300`}>The audit failed: {audit.error}</p>
      )}

      {audit.status === 'complete' && (
        <>
          <section className={`${card} flex flex-wrap items-center gap-6 p-6`}>
            <Score label="Technical" value={audit.technicalScore} size="lg" />
            <Score label="GEO" value={audit.geoScore} size="lg" />
            <div className="flex flex-col gap-2 text-sm">
              <IssueTotals counts={audit.issueCounts} />
              <p className="text-slate-400">
                {audit.pagesCrawled} pages crawled
                {audit.result?.pagesSkippedByRobots ? ` · ${audit.result.pagesSkippedByRobots} skipped by robots.txt` : ''}
              </p>
            </div>
          </section>

          <section className={card}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-6 py-4">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={t.key === 'all' ? `/audits/${id}` : `/audits/${id}?category=${t.key}`}
                  className={`rounded-full px-3 py-1 text-sm ${category === t.key ? 'bg-[var(--color-accent)] font-semibold text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
            {sorted.length === 0 ? (
              <p className="px-6 py-5 text-sm text-slate-400">No issues in this category. 🎉</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {sorted.map((g) => {
                  const pagesAffected = g.items.filter((i) => i.pageUrl);
                  return (
                    <li key={g.code}>
                      <details className="group px-6 py-4">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                          <SeverityBadge severity={g.severity} />
                          <span className="text-xs uppercase tracking-wide text-slate-500">{g.category}</span>
                          <span className="flex-1 text-sm text-slate-100">{g.items[0].message}</span>
                          <span className="text-xs text-slate-500">
                            {pagesAffected.length ? `${pagesAffected.length} page${pagesAffected.length === 1 ? '' : 's'}` : 'site-wide'}
                          </span>
                        </summary>
                        {pagesAffected.length > 0 && (
                          <ul className="mt-3 flex flex-col gap-1.5 pl-2 text-sm">
                            {pagesAffected.slice(0, 200).map((i) => (
                              <li key={i.id} className="flex flex-col">
                                <a href={i.pageUrl!} target="_blank" rel="noreferrer" className="truncate text-slate-300 hover:text-[var(--color-accent)]">
                                  {i.pageUrl}
                                </a>
                                {i.message !== g.items[0].message && <span className="text-xs text-slate-500">{i.message}</span>}
                                {Array.isArray(i.details?.links) && (
                                  <span className="text-xs text-rose-300/80">→ {(i.details!.links as string[]).join(', ')}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={card}>
            <h2 className="border-b border-slate-800 px-6 py-4 text-lg font-semibold">Pages crawled</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">URL</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Load</th>
                    <th className="px-3 py-3 font-medium">Words</th>
                    <th className="px-6 py-3 font-medium">Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {pages.map((p) => (
                    <tr key={p.id}>
                      <td className="max-w-xs truncate px-6 py-2.5">
                        <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)]">
                          {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </a>
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums ${p.statusCode && p.statusCode >= 400 ? 'text-rose-300' : ''}`}>
                        {p.statusCode ?? 'error'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{p.loadMs !== null ? `${p.loadMs} ms` : '–'}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{p.wordCount ?? '–'}</td>
                      <td className="max-w-sm truncate px-6 py-2.5 text-slate-400">{p.title ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
