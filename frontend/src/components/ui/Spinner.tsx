export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex items-center gap-3 py-8 text-ink-secondary"
    >
      <span
        className="h-5 w-5 animate-spin rounded-pill border-2 border-line-strong border-t-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="text-body">{label}</span>
    </div>
  );
}
