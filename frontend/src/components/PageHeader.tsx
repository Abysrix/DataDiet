import type { ReactNode } from "react";

/**
 * The page's only H1, with its job-focused description and a compact action
 * cluster. The rule under the header is the Swiss-style seam between "where I
 * am" and "what I am looking at"; actions drop below the text on narrow screens
 * instead of squeezing the title.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-gutter flex flex-col gap-4 border-b border-line pb-stack sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-title font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-body text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
