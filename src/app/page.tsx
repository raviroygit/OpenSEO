export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">
        Open<span className="text-[var(--color-accent)]">SEO</span>
      </h1>
      <p className="text-lg text-slate-400">
        Open-source, self-hostable SEO &amp; GEO auditing platform.
      </p>
      <p className="text-sm text-slate-500">
        This instance is running. Health endpoint:{' '}
        <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5">/api/health</code>
      </p>
    </main>
  );
}
