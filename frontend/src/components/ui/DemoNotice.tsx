import { StatusIcon } from "../icons";

/**
 * Persistent honesty banner: every number shown in the Phase 1 UI comes from
 * synthetic fixtures served by the backend's /api/v1/demo endpoints.
 */
export function DemoNotice({ notice }: { notice?: string }) {
  return (
    <div
      className="mb-gutter flex items-start gap-2 rounded-card border border-warning-line bg-warning-surface px-card-x py-3 text-supporting text-warning-ink"
      role="note"
    >
      <StatusIcon tone="warning" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold">Synthetic data.</span>{" "}
        <span>
          {notice ??
            "All figures on this page are generated development samples — no real institutional or personal records are included."}
        </span>
      </p>
    </div>
  );
}
