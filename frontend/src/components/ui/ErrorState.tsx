import { IconRefresh, StatusIcon } from "../icons";
import { Button } from "./Button";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Optional operator guidance; no generic "start uvicorn" text by default. */
  hint?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  hint,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-card border border-critical-line bg-critical-surface px-card-x py-6 text-critical-ink"
    >
      <div className="flex items-start gap-2">
        <StatusIcon tone="critical" className="mt-0.5 h-4 w-4 shrink-0" />
        <h2 className="text-body font-semibold">{title}</h2>
      </div>
      <p className="mt-1 max-w-prose text-supporting">{message}</p>
      {hint ? <p className="mt-2 text-meta text-critical-ink">{hint}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
          <IconRefresh className="h-4 w-4" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
