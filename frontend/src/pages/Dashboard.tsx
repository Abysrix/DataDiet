/**
 * Dashboard: counts read from the real summary endpoint.
 *
 * The page never holds fixture numbers. It either renders the server's scoped
 * aggregation, an explicit empty state, a loading state, or a data error. The
 * small client-side permission check is usability only: the API rechecks the
 * verified identity on every request.
 */

import { Link } from "react-router-dom";
import { getDashboardSummary } from "../api/dashboard";
import type {
  AssetSensitivity,
  LifecycleStatus,
  RecommendationState,
  RiskBand,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { BarList } from "../components/ui/BarList";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { FOCUS_RING } from "../components/ui/control";
import { Spinner } from "../components/ui/Spinner";
import { StatCard } from "../components/ui/StatCard";
import { IconChevronRight, IconRefresh, IconShield } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";
import { humanize } from "../lib/format";
import { toneForLifecycleStatus, toneForRiskBand, toneForSensitivity } from "../lib/semantic";

const LINK_CLASS = `inline-flex min-h-9 items-center gap-1.5 rounded-control px-control-x py-control-y text-body font-medium transition-colors ${FOCUS_RING}`;
const PRIMARY_LINK = `${LINK_CLASS} bg-accent text-on-accent hover:bg-accent-hover`;
const SECONDARY_LINK = `${LINK_CLASS} bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-hover`;

const RECOMMENDATION_TONES: Record<RecommendationState, "success" | "warning" | "caution" | "critical" | "info" | "neutral"> = {
  RETAIN: "success",
  ARCHIVE_RECOMMENDED: "info",
  REVIEW_REQUIRED: "warning",
  DISPOSAL_REVIEW_REQUIRED: "caution",
  BLOCKED_BY_HOLD: "critical",
  NO_APPLICABLE_POLICY: "neutral",
};

function DashboardHeader() {
  const { has } = useAuth();
  return (
    <PageHeader
      title="Dashboard"
      description="Counts below are read from the DataDiet API and filtered to the institution scope in your verified session. No figure is calculated in the browser."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {has("retention:read") ? (
            <Link to="/recommendations" className={PRIMARY_LINK}>
              Review queue
              <IconChevronRight className="h-4 w-4" />
            </Link>
          ) : null}
          {has("inventory:read") ? (
            <Link to="/inventory" className={SECONDARY_LINK}>
              Inspect inventory
            </Link>
          ) : null}
        </div>
      }
    />
  );
}

function DashboardData({ institutionId }: { institutionId: number | null }) {
  const { data, loading, error, refetch } = useApiQuery(
    (signal) => getDashboardSummary(institutionId, signal),
    [institutionId],
  );

  if (error) {
    return <ErrorState title="Dashboard unavailable" message={error} onRetry={refetch} />;
  }

  if (loading && data === null) {
    return (
      <Card>
        <CardHeader
          title="Loading summary"
          description="Reading stored inventory and workflow counts from the API."
        />
        <CardBody>
          <Spinner label="Loading dashboard…" />
        </CardBody>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const lifecycle = Object.entries(data.lifecycle).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone: toneForLifecycleStatus(key as LifecycleStatus),
  }));
  const sensitivity = Object.entries(data.sensitivity).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone: toneForSensitivity(key as AssetSensitivity),
  }));
  const risk = Object.entries(data.risk_bands).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone: toneForRiskBand(key as RiskBand),
  }));
  const recommendations = Object.entries(data.recommendations).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone: RECOMMENDATION_TONES[key as RecommendationState],
  }));
  const scans = Object.entries(data.scan_jobs).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone:
      key === "COMPLETED"
        ? ("success" as const)
        : key === "FAILED" || key === "CANCELLED"
          ? ("critical" as const)
          : ("neutral" as const),
  }));

  return (
    <div className="space-y-gutter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-supporting text-ink-muted">
          {institutionId === null
            ? "Scope: every institution this account can read"
            : `Scope: institution #${institutionId}`}
        </p>
        <Button variant="secondary" onClick={refetch} className="gap-1.5" disabled={loading}>
          <IconRefresh className="h-4 w-4" />
          Refresh summary
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assets" value={data.total_assets} hint="Stored inventory records" />
        <StatCard label="Active policies" value={data.active_policies} hint="Approved and active" />
        <StatCard label="Active holds" value={data.active_holds} hint="Block a recommendation" />
        <StatCard label="Scanned records" value={data.scanned_records} hint="From completed scans" />
        <StatCard label="Assessments" value={data.assessments} hint="Retention recommendations" />
        <StatCard label="Review decisions" value={data.decisions} hint="Recorded by a human" />
        <StatCard
          label="High or critical risk"
          value={data.risk_bands.high + data.risk_bands.critical}
          hint="Documented indicator bands"
        />
        <StatCard
          label="Under review"
          value={data.lifecycle.under_review}
          hint="Assets awaiting review"
        />
      </div>

      {data.total_assets === 0 ? (
        <EmptyState
          title="No records in this scope"
          message="The API returned zero inventory records. Nothing is invented here: add a reviewed source and run a scan to populate this view."
        />
      ) : null}

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Lifecycle distribution"
            description="Asset lifecycle states, counted by the API."
          />
          <CardBody>
            <BarList items={lifecycle} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Sensitivity distribution"
            description="Classification values stored on inventoried assets."
          />
          <CardBody>
            <BarList items={sensitivity} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Risk bands"
            description="Stored scores from the documented rule set, not browser-computed values."
          />
          <CardBody>
            <BarList items={risk} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recommendations"
            description="Latest retention recommendation recorded for each assessed asset."
          />
          <CardBody>
            <BarList items={recommendations} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Scan jobs"
            description={`${data.scan_jobs.COMPLETED} completed jobs · ${Object.values(data.scan_jobs).reduce((sum, count) => sum + count, 0)} total jobs`}
          />
          <CardBody>
            <BarList items={scans} />
          </CardBody>
        </Card>
      </div>
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
        <DashboardData institutionId={activeInstitutionId} />
      ) : null}
    </div>
  );
}
