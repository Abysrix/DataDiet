/**
 * Dashboard: a deliberately short snapshot of the real summary endpoint.
 *
 * The page shows one posture band, one decision cue and two distributions. It
 * never holds fixture numbers: every figure comes from the server's scoped
 * aggregation, or the page shows an explicit loading, empty, error, permission
 * or signed-out state. The client-side permission check is usability only; the
 * API rechecks the verified identity on every request.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { getDashboardSummary } from "../api/dashboard";
import type { LifecycleStatus, RiskBand } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Distribution3D } from "../components/Distribution3D";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { BarList } from "../components/ui/BarList";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { FOCUS_RING } from "../components/ui/control";
import { Spinner } from "../components/ui/Spinner";
import { IconChevronRight, IconRefresh, IconShield } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";
import { humanize } from "../lib/format";
import { toneForLifecycleStatus, toneForRiskBand } from "../lib/semantic";

const LINK_CLASS = `inline-flex min-h-9 items-center gap-1.5 rounded-control px-control-x py-control-y text-body font-medium transition-colors ${FOCUS_RING}`;
const PRIMARY_LINK = `${LINK_CLASS} bg-accent text-on-accent hover:bg-accent-hover`;
const SECONDARY_LINK = `${LINK_CLASS} bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-hover`;

/** A metric in the posture band; only the first one is given display weight. */
function PostureMetric({
  label,
  value,
  hint,
  primary = false,
}: {
  label: string;
  value: number;
  hint: string;
  primary?: boolean;
}) {
  return (
    <div className="min-w-0 px-card-x py-card-y">
      <p className="text-eyebrow font-medium text-ink-muted uppercase tracking-wide">{label}</p>
      <p
        className={`mt-3 font-semibold tabular-nums text-ink ${primary ? "text-display" : "text-title"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-meta text-ink-secondary">{hint}</p>
    </div>
  );
}

/**
 * Content-shaped loading state. A skeleton keeps the edited layout's rhythm
 * while the request is in flight; `aria-busy` and hidden blocks keep it quiet.
 */
function SummarySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard summary"
      className="animate-pulse space-y-gutter motion-reduce:animate-none"
    >
      <span className="sr-only">Loading summary…</span>
      <div
        aria-hidden="true"
        className="grid gap-gutter xl:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <div className="h-56 rounded-card border border-line bg-surface p-card-y shadow-card">
          <div className="h-3 w-36 rounded-pill bg-surface-sunken" />
          <div className="mt-8 grid grid-cols-3 gap-stack">
            <div className="h-12 rounded-control bg-surface-sunken" />
            <div className="h-12 rounded-control bg-surface-sunken" />
            <div className="h-12 rounded-control bg-surface-sunken" />
          </div>
        </div>
        <div className="h-56 rounded-card border border-line bg-surface p-card-y shadow-card">
          <div className="h-3 w-24 rounded-pill bg-surface-sunken" />
          <div className="mt-8 h-12 w-20 rounded-control bg-surface-sunken" />
          <div className="mt-4 h-3 w-40 rounded-pill bg-surface-sunken" />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-gutter lg:grid-cols-2">
        <div className="h-52 rounded-card border border-line bg-surface p-card-y shadow-card">
          <div className="h-3 w-32 rounded-pill bg-surface-sunken" />
          <div className="mt-6 h-32 rounded-control bg-surface-sunken" />
        </div>
        <div className="h-52 rounded-card border border-line bg-surface p-card-y shadow-card">
          <div className="h-3 w-28 rounded-pill bg-surface-sunken" />
          <div className="mt-6 space-y-4">
            <div className="h-2 rounded-pill bg-surface-sunken" />
            <div className="h-2 rounded-pill bg-surface-sunken" />
            <div className="h-2 rounded-pill bg-surface-sunken" />
            <div className="h-2 rounded-pill bg-surface-sunken" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardHeader() {
  const { has } = useAuth();
  return (
    <PageHeader
      title="Dashboard"
      description="A scoped snapshot of inventory and the decisions waiting on it."
      actions={
        has("retention:read") ? (
          <Link to="/recommendations" className={PRIMARY_LINK}>
            Review queue
            <IconChevronRight className="h-4 w-4" />
          </Link>
        ) : null
      }
    />
  );
}

function DashboardData({
  institutionId,
  canReview,
}: {
  institutionId: number | null;
  canReview: boolean;
}) {
  const { data, loading, error, refetch } = useApiQuery(
    (signal) => getDashboardSummary(institutionId, signal),
    [institutionId],
  );

  const lifecycle = useMemo(
    () =>
      Object.entries(data?.lifecycle ?? {}).map(([key, value]) => ({
        label: humanize(key),
        value,
        tone: toneForLifecycleStatus(key as LifecycleStatus),
      })),
    [data],
  );
  const risk = useMemo(
    () =>
      Object.entries(data?.risk_bands ?? {}).map(([key, value]) => ({
        label: humanize(key),
        value,
        tone: toneForRiskBand(key as RiskBand),
      })),
    [data],
  );

  if (error) {
    return <ErrorState title="Dashboard unavailable" message={error} onRetry={refetch} />;
  }

  if (loading && data === null) {
    return <SummarySkeleton />;
  }

  if (!data) {
    return null;
  }

  const highCritical = data.risk_bands.high + data.risk_bands.critical;
  const waiting = data.lifecycle.under_review;

  return (
    <div className="space-y-gutter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-supporting text-ink-muted">
          {institutionId === null
            ? "Scope: every institution this account can read"
            : `Scope: institution #${institutionId}`}
        </p>
        <Button variant="secondary" size="sm" onClick={refetch} disabled={loading}>
          <IconRefresh className="h-4 w-4" />
          Refresh summary
        </Button>
      </div>

      <div className="grid gap-gutter xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          aria-labelledby="dashboard-posture"
          className="min-w-0 rounded-card border border-line bg-surface shadow-card"
        >
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-card-x py-card-y">
            <div>
              <p className="text-eyebrow font-semibold text-ink-muted uppercase tracking-wide">
                Scoped snapshot
              </p>
              <h2 id="dashboard-posture" className="mt-1 text-title font-semibold tracking-tight text-ink">
                Current posture
              </h2>
            </div>
            <Badge tone="neutral">
              {institutionId === null ? "All institutions" : `Institution #${institutionId}`}
            </Badge>
          </header>
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <PostureMetric
              primary
              label="Assets in scope"
              value={data.total_assets}
              hint="Stored inventory records"
            />
            <PostureMetric
              label="Awaiting decision"
              value={waiting}
              hint="Assets under review"
            />
            <PostureMetric
              label="High / critical"
              value={highCritical}
              hint="Documented risk bands"
            />
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-sunken px-card-x py-stack">
            <p className="text-supporting text-ink-secondary">
              <span className="font-medium tabular-nums text-ink">{data.scanned_records}</span>{" "}
              records scanned ·{" "}
              <span className="font-medium tabular-nums text-ink">
                {data.scan_jobs.COMPLETED}
              </span>{" "}
              completed jobs
            </p>
            <Link to="/inventory" className={SECONDARY_LINK}>
              Inspect inventory
              <IconChevronRight className="h-4 w-4" />
            </Link>
          </footer>
        </section>

        <aside className="min-w-0 rounded-card border border-line border-l-2 border-l-accent bg-surface px-card-x py-card-y shadow-card">
          <p className="text-eyebrow font-semibold text-ink-muted uppercase tracking-wide">
            Next action
          </p>
          <h2 className="mt-3 text-body font-semibold text-ink">Review queue</h2>
          <p className="mt-4 text-display font-semibold tabular-nums text-ink">{waiting}</p>
          <p className="mt-1 text-supporting text-ink-secondary">
            {waiting === 1 ? "asset is" : "assets are"} waiting for a recorded decision.{" "}
            {data.active_holds} active {data.active_holds === 1 ? "hold" : "holds"} in scope.
          </p>
          {canReview ? (
            <Link to="/recommendations" className={`${PRIMARY_LINK} mt-stack`}>
              Open queue
              <IconChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <p className="mt-stack text-meta text-ink-muted">
              Review permission is required to open the queue.
            </p>
          )}
        </aside>
      </div>

      {data.total_assets === 0 ? (
        <EmptyState
          title="No records in this scope"
          message="The API returned zero inventory records. Nothing is invented here: add a reviewed source and run a scan to populate this view."
        />
      ) : null}

      <section aria-label="Stored distributions" className="grid gap-gutter lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Risk distribution"
            description="Bands from stored assessments; column height follows the count."
          />
          <CardBody>
            <Distribution3D items={risk} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Lifecycle mix"
            description="Where the inventory in this scope currently sits."
          />
          <CardBody>
            <BarList items={lifecycle} />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

/**
 * Rendered only after the server-verified session has passed the read gate, so
 * an account without `inventory:read` never provokes an API 403.
 */
export default function Dashboard() {
  const { status, has, activeInstitutionId } = useAuth();
  const canRead = has("inventory:read");

  return (
    <div className="space-y-gutter">
      <DashboardHeader />

      {status === "loading" ? (
        <Card>
          <CardHeader
            title="Checking access"
            description="Verifying the permissions returned for this session."
          />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      ) : null}

      {status === "anonymous" ? (
        <Card>
          <CardHeader
            title="Dashboard data needs a session"
            description="No verified identity is available, so no summary request was made."
          />
          <CardBody>
            <EmptyState
              title="Sign in to view the dashboard"
              message="The summary endpoint requires a verified DataDiet session."
              action={
                <Link to="/signin" className={LINK_CLASS}>
                  Go to sign in
                  <IconChevronRight className="h-4 w-4" />
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && !canRead ? (
        <Card>
          <CardHeader
            title="Dashboard data is not available to this account"
            description="The server-verified permissions for this session do not include inventory:read."
            action={<Badge tone="neutral">Permission required</Badge>}
          />
          <CardBody className="flex items-start gap-3">
            <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
            <p className="text-supporting text-ink-secondary">
              The API would refuse this request, so no request was made. This is shown as
              information, not as a retryable data error.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && canRead ? (
        <DashboardData institutionId={activeInstitutionId} canReview={has("retention:read")} />
      ) : null}
    </div>
  );
}
