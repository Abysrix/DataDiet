import type { ReactNode } from "react";
import { IconInfoCircle } from "../icons";

export interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-line bg-surface px-card-x py-10 text-center">
      <IconInfoCircle className="mx-auto h-6 w-6 text-ink-subtle" />
      <h2 className="mt-2 text-body font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1 max-w-prose text-supporting text-ink-muted">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
