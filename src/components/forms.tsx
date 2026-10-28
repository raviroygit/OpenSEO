'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, updateProject, type FormState } from '@/app/actions';
import type { Project } from '@/db/schema';
import { button, input } from './ui';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function ScheduleAndLimits({ project }: { project?: Project }) {
  return (
    <>
      <Field label="Re-audit" hint="Scheduled audits run overnight (UTC).">
        <select name="schedule" defaultValue={project?.schedule ?? 'weekly'} className={input}>
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
          <option value="off">Off (manual only)</option>
        </select>
      </Field>
      <Field label="Max pages per audit" hint="5–1000. Bigger sites take longer.">
        <input name="maxPages" type="number" min={5} max={1000} defaultValue={project?.maxPages ?? 100} className={input} />
      </Field>
      <Field label="Alert email" hint="Emailed when a score drops 5+ points or a new critical issue appears.">
        <input name="alertEmail" type="email" placeholder="you@example.com" defaultValue={project?.alertEmail ?? ''} className={input} />
      </Field>
    </>
  );
}

export function AddProjectForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createProject, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Website" hint="The home page — https:// is added if missing.">
        <input name="domain" required placeholder="www.example.com" className={input} autoComplete="off" />
      </Field>
      <Field label="Name" hint="Optional; defaults to the domain.">
        <input name="name" placeholder="Example" className={input} />
      </Field>
      <ScheduleAndLimits />
      {state.error && <p className="text-sm text-rose-300 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Adding…' : 'Add project & run first audit'}
        </button>
      </div>
    </form>
  );
}

export function ProjectSettingsForm({ project }: { project: Project }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProject, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={project.id} />
      <Field label="Name">
        <input name="name" required defaultValue={project.name} className={input} />
      </Field>
      <ScheduleAndLimits project={project} />
      {state.error && <p className="text-sm text-rose-300 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

/** Re-renders the server page every few seconds while an audit is in flight. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
