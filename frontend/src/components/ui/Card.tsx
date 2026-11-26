import type { ReactNode } from "react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`min-w-0 rounded-card border border-line bg-surface shadow-card ${className ?? ""}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-card-x py-card-y">
      <div className="min-w-0">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-prose text-supporting text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 px-card-x py-card-y ${className ?? ""}`}>{children}</div>;
}
