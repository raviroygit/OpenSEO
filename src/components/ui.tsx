import type { Audit, IssueCounts, Severity } from '@/db/schema';

export function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-500 border-slate-700';
  if (score >= 90) return 'text-emerald-300 border-emerald-500/40';
  if (score >= 70) return 'text-amber-300 border-amber-500/40';
  return 'text-rose-300 border-rose-500/40';
}

export function Score({ label, value, size = 'md' }: { label: string; value: number | null | undefined; size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border bg-[var(--color-surface)] ${scoreTone(value)} ${big ? 'h-28 w-28' : 'h-16 w-16'}`}
    >
      <span className={`font-semibold tabular-nums ${big ? 'text-4xl' : 'text-xl'}`}>{value ?? '–'}</span>
      <span className={`uppercase tracking-wide text-slate-400 ${big ? 'text-xs' : 'text-[10px]'}`}>{label}</span>
    </div>
  );
}

const STATUS_STYLE: Record<Audit['status'], string> = {
  queued: 'bg-slate-700/60 text-slate-200',
  running: 'bg-sky-500/20 text-sky-300',
  complete: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-rose-500/15 text-rose-300',
};

export function StatusPill({ status }: { status: Audit['status'] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {(status === 'running' || status === 'queued') && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </span>
  );
}

export const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  notice: 'bg-slate-600/30 text-slate-300 border-slate-500/30',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[severity]}`}>
      {severity}
    </span>
  );
}

export function IssueTotals({ counts }: { counts: IssueCounts | null | undefined }) {
  if (!counts) return <span className="text-slate-500">–</span>;
  return (
    <span className="flex gap-3 text-sm tabular-nums">
      <span className="text-rose-300">{counts.critical} critical</span>
      <span className="text-amber-300">{counts.warning} warnings</span>
      <span className="text-slate-400">{counts.notice} notices</span>
    </span>
  );
}

export function ago(date: Date | null | undefined): string {
  if (!date) return '–';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export const card = 'rounded-2xl border border-slate-800 bg-[var(--color-surface)]';
export const input =
  'w-full rounded-lg border border-slate-700 bg-[var(--color-canvas)] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[var(--color-accent)]';
export const button =
  'inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60';
export const ghostButton =
  'inline-flex items-center justify-center rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500';
