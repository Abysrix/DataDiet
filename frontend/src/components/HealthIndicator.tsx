import { fetchHealth } from "../api/health";
import { useApiQuery } from "../hooks/useApiQuery";
import { StatusIcon } from "./icons";
import { TONE_INK } from "./ui/statusClasses";
import { resolveStatusTone, type Tone } from "../lib/semantic";

interface HealthState {
  tone: Tone;
  label: string;
  pending: boolean;
}

/**
 * Live API status indicator. Uses the backend liveness endpoint, so it works
 * even when MySQL is not running.
 *
 * The glyph and its ink come from the shared status roles rather than a palette
 * class at this call site, so "offline" reads exactly like an offline badge
 * anywhere else in the product.
 */
export function HealthIndicator() {
  const { data, loading, error } = useApiQuery(fetchHealth, []);

  const state: HealthState = loading
    ? { tone: "neutral", label: "Checking API…", pending: true }
    : error || !data
      ? { tone: "critical", label: "API offline", pending: false }
      : {
          tone: "success",
          label: `API ${data.status} · ${data.environment} · v${data.version}`,
          pending: false,
        };

  const role = resolveStatusTone(state.tone);

  return (
    <span
      role="status"
      aria-busy={state.pending || undefined}
      title={state.label}
      className="inline-flex min-w-0 max-w-full items-center gap-2 text-meta text-ink-secondary"
    >
      {/* Glyph plus text: state is never carried by the colour alone. */}
      <StatusIcon
        tone={role}
        className={`h-4 w-4 shrink-0 ${TONE_INK[role]} ${
          state.pending ? "animate-pulse motion-reduce:animate-none" : ""
        }`}
      />
      <span className="truncate">{state.label}</span>
    </span>
  );
}
