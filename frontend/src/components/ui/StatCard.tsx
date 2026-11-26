import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface px-card-x py-card-y shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow font-semibold text-ink-muted uppercase tracking-wide">
          {label}
        </p>
        {icon ? <span className="shrink-0 text-ink-subtle">{icon}</span> : null}
      </div>
      <p className="mt-2 text-display font-semibold text-ink tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-meta text-ink-muted">{hint}</p> : null}
    </div>
  );
}
