import type { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sublabel,
  tone = 'slate',
}: {
  label: string;
  value: number | string;
  sublabel?: string;
  tone?: 'slate' | 'blue' | 'amber' | 'red' | 'green' | 'indigo';
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    green: 'text-emerald-700',
    indigo: 'text-indigo-700',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tones[tone]}`}>{value}</p>
      {sublabel ? <p className="mt-1 text-xs text-slate-500">{sublabel}</p> : null}
    </div>
  );
}
