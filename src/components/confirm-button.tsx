'use client';

import { useState } from 'react';

/**
 * A submit button that asks for a second click instead of a browser
 * confirm() dialog — destructive actions (delete project) need intent.
 */
export function ConfirmButton({ label, confirmLabel, className }: { label: string; confirmLabel: string; className: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button type="submit" className={`${className} !border-rose-500 !text-rose-300`}>
        {confirmLabel}
      </button>
      <button type="button" className="text-sm text-slate-400 hover:text-slate-200" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}
