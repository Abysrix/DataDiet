import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchDashboard } from "../api/demo";
import type { DashboardSummary, Permission, RetentionAction, RiskBand, Sensitivity } from "../api/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { BarList, type BarItem } from "../components/ui/BarList";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { DemoNotice } from "../components/ui/DemoNotice";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";
import { TONE_SOLID } from "../components/ui/statusClasses";
import { IconChevronRight } from "../components/icons";
import { formatBytes, formatDate, humanize } from "../lib/format";
import {
  toneForRetentionAction,
  toneForRiskBand,
  toneForSensitivity,
  type Tone,
} from "../lib/semantic";

/** Highest severity first: the point of the band chart is what to look at next. */
const BAND_ORDER: Array<{ band: RiskBand; label: string }> = [
  { band: "critical", label: "Critical (75–100)" },
  { band: "high", label: "High (50–74)" },
  { band: "moderate", label: "Moderate (25–49)" },
  { band: "low", label: "Low (0–24)" },
];

const SENSITIVITY_ORDER: Array<{ level: Sensitivity; label: string }> = [
  { level: "restricted", label: "Restricted" },
  { level: "confidential", label: "Confidential" },
  { level: "internal", label: "Internal" },
  { level: "public", label: "Public" },
];

const ACTION_ORDER: Array<{ action: RetentionAction; label: string }> = [
  { action: "retain", label: "Retain" },
  { action: "archive", label: "Archive" },
  { action: "review", label: "Review" },
  { action: "eligible_for_disposal", label: "Eligible for disposal" },
];

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * A share of one distribution.
 *
 * The denominator is that distribution's own total, never `total_records`: the
 * summary does not promise the breakdowns add up to the record count, and a
 * percentage is only honest against a number the payload actually supplies.
 */
function shareOf(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "—";
}

/** The next legitimate destinations, ranked by the decision a reviewer makes next. */
const PRIMARY_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-control-x py-control-y text-body font-medium text-on-accent transition-colors hover:bg-accent-hover";
const SECONDARY_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-control bg-surface px-control-x py-control-y text-body font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-hover";

export default function Dashboard() {
  const { data, loading, error, refetch } = useApiQuery(fetchDashboard, []);
  const { has } = useAuth();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Inventory volume, sensitivity mix, explainable risk bands, and lifecycle activity across all discovered records."
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

      {loading ? <Spinner label="Loading dashboard summary…" /> : null}
      {error ? (
        <ErrorState title="Dashboard unavailable" message={error} onRetry={refetch} />
      ) : null}

      {data ? (
        <>
          <DemoNotice notice={data.meta.notice} />
          <DashboardContent summary={data.data} />
        </>
      ) : null}
    </div>
  );
}

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const riskBands = BAND_ORDER.map((entry) => ({
    label: entry.label,
    value: summary.by_risk_band[entry.band],
    tone: toneForRiskBand(entry.band),
  }));
  const riskTotal = sum(riskBands.map((band) => band.value));
  const elevatedRisk = summary.by_risk_band.critical + summary.by_risk_band.high;

  const sensitivityItems: BarItem[] = SENSITIVITY_ORDER.map((entry) => ({
    label: entry.label,
    value: summary.by_sensitivity[entry.level],
    tone: toneForSensitivity(entry.level),
  }));
  const sensitivityTotal = sum(sensitivityItems.map((item) => item.value));

  const actionItems: BarItem[] = ACTION_ORDER.map((entry) => ({
    label: entry.label,
    value: summary.by_retention_action[entry.action],
    tone: toneForRetentionAction(entry.action),
  }));

  return (
    <div className="space-y-gutter">
      <MetricLedger
        metrics={[
          {
            label: "Inventory records",
            value: summary.total_records,
            hint: "Discovered sample records",
          },
          {
            label: "Storage tracked",
            value: formatBytes(summary.storage_bytes),
            hint: `Summed across ${summary.total_records} record${summary.total_records === 1 ? "" : "s"}`,
          },
          {
            label: "High or Critical risk",
            value: elevatedRisk,
            hint: `Of ${riskTotal} risk-banded records`,
          },
          {
            label: "Pending approvals",
            value: summary.pending_approvals,
            hint: "Human decisions required",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
        <RiskOverview bands={riskBands} total={riskTotal} className="xl:col-span-3 xl:self-start" />
        <AttentionRequired summary={summary} className="xl:col-span-2" />
      </div>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">
        <Card>
          <CardHeader
            title="Sensitivity distribution"
            description="Records by assigned sensitivity level"
            action={<DistributionTotal total={sensitivityTotal} />}
          />
          <CardBody>
            <BarList items={sensitivityItems} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recommended action mix"
            description="Synthetic sample values — advisory recommendations only"
          />
          <CardBody>
            <BarList items={actionItems} />
          </CardBody>
        </Card>
      </div>

      <ActivityCard activity={summary.recent_activity} />
    </div>
  );
}

function DistributionTotal({ total }: { total: number }) {
  return (
    <p className="text-meta tabular-nums text-ink-muted">
      {total} record{total === 1 ? "" : "s"}
    </p>
  );
}

/**
 * The volume figures in one hairline-divided panel rather than four cards: the
 * numbers are read together, so they are framed together. A `<dl>` keeps each
 * label bound to its value, which four loose `<div>`s would not announce.
 */
function MetricLedger({
  metrics,
}: {
  metrics: Array<{ label: string; value: string | number; hint: string }>;
}) {
  return (
    <section
      aria-labelledby="dashboard-metrics"
      className="overflow-hidden rounded-card border border-line bg-line shadow-card"
    >
      <h2 id="dashboard-metrics" className="sr-only">
        Summary metrics
      </h2>
      <dl className="grid grid-cols-1 gap-px sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-surface px-card-x py-card-y">
            <dt className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-ink-muted">
              {metric.label}
            </dt>
            <dd className="mt-2 text-display font-semibold tabular-nums text-ink">
              {metric.value}
            </dd>
            <dd className="mt-1 text-meta text-ink-muted">{metric.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RiskOverview({
  bands,
  total,
  className,
}: {
  bands: Array<{ label: string; value: number; tone: Tone }>;
  total: number;
  className?: string;
}) {
  const present = bands.filter((band) => band.value > 0);

  return (
    <Card className={className}>
      <CardHeader
        title="Risk band distribution"
        description="From documented indicator rules (rule set v1)"
        action={
          <Link
            to="/risk"
            className="inline-flex items-center gap-1 rounded-control text-meta font-medium text-accent-ink transition-colors hover:text-accent hover:underline"
          >
            View risk analysis
            <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <CardBody className="space-y-4">
        {/*
          The bar is decoration for the legend below it, so it is hidden from
          assistive tech rather than announced as a fourth unnamed graphic: the
          list carries every label, count and share as text.
        */}
        {present.length > 0 ? (
          <div
            aria-hidden="true"
            className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill bg-surface-sunken"
          >
            {present.map((band) => (
              <div
                key={band.label}
                className={`h-full rounded-pill ${TONE_SOLID[band.tone]}`}
                style={{ flexGrow: band.value }}
              />
            ))}
          </div>
        ) : (
          <p className="text-supporting text-ink-muted">
            No records are risk-banded in this summary.
          </p>
        )}

        <ul className="grid grid-cols-1 gap-x-gutter gap-y-2 sm:grid-cols-2">
          {bands.map((band) => (
            <li key={band.label} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-body text-ink-secondary">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-pill ${TONE_SOLID[band.tone]}`}
                />
                <span className="truncate">{band.label}</span>
              </span>
              <span className="text-data whitespace-nowrap tabular-nums text-ink-muted">
                <span className="font-semibold text-ink">{band.value}</span>
                <span className="ml-1.5">{shareOf(band.value, total)}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-meta text-ink-subtle">
          Shares are of the {total} risk-banded record{total === 1 ? "" : "s"} in this summary.
        </p>
      </CardBody>
    </Card>
  );
}

interface AttentionRow {
  key: string;
  label: string;
  hint: string;
  value: number;
  to: string;
  permission: Permission;
}

function AttentionRequired({
  summary,
  className,
}: {
  summary: DashboardSummary;
  className?: string;
}) {
  const { has } = useAuth();

  const candidates: AttentionRow[] = [
    {
      key: "duplicates",
      label: "Duplicate candidates",
      hint: "Flagged for review, never auto-deleted",
      value: summary.duplicate_candidates,
      to: "/inventory",
      permission: "inventory:read",
    },
    {
      key: "review",
      label: "Marked for review",
      hint: "Advisory, from the synthetic summary",
      value: summary.by_retention_action.review,
      to: "/recommendations",
      permission: "retention:read",
    },
    {
      key: "disposal",
      label: "Marked eligible for disposal",
      hint: "Advisory only — disposal is not implemented",
      value: summary.by_retention_action.eligible_for_disposal,
      to: "/recommendations",
      permission: "retention:read",
    },
    {
      key: "retrieval",
      label: "Retrieval requests (not implemented)",
      hint: "No restore workflow exists yet",
      value: summary.open_retrieval_requests,
      to: "/retrieval",
      permission: "sources:read",
    },
  ];
  const rows = candidates.filter((row) => row.value > 0);

  return (
    <Card className={className}>
      <CardHeader
        title="Attention required"
        description="Outstanding items in the synthetic sample set"
      />
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="px-card-x py-card-y text-supporting text-ink-muted">
            Nothing outstanding in this summary.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const label = (
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{row.label}</span>
                  <span className="block text-meta text-ink-muted">{row.hint}</span>
                </span>
              );
              const count = (
                <span className="shrink-0 text-title font-semibold tabular-nums text-ink">
                  {row.value}
                </span>
              );

              /*
               * Same rule as the shell breadcrumb: a row links only when the
               * signed-in account may already see that navigation item. The
               * count is still shown — hiding the number would hide a fact,
               * while linking to a refused area would offer a dead end. The
               * chevron belongs to the link only, so a plain row never looks
               * like a control that was disabled.
               */
              return (
                <li key={row.key}>
                  {has(row.permission) ? (
                    <Link
                      to={row.to}
                      className="flex items-center gap-3 px-card-x py-3 transition-colors hover:bg-surface-hover"
                    >
                      {label}
                      {count}
                      <IconChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-card-x py-3">
                      {label}
                      {count}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ActivityCard({ activity }: { activity: DashboardSummary["recent_activity"] }) {
  return (
    <Card>
      <CardHeader title="Recent activity" description="Latest synthetic lifecycle events" />
      <CardBody className="p-0">
        {activity.length === 0 ? (
          <p className="px-card-x py-card-y text-supporting text-ink-muted">
            No lifecycle events have been recorded in the sample set.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {activity.map((item) => (
              <li
                key={item.event_id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-card-x py-3"
              >
                <time
                  dateTime={item.occurred_on}
                  className="w-24 shrink-0 text-meta tabular-nums text-ink-muted"
                >
                  {formatDate(item.occurred_on)}
                </time>
                <Badge tone="neutral">{humanize(item.event_type)}</Badge>
                <span className="w-full min-w-0 text-body text-ink-secondary sm:w-auto sm:flex-1">
                  {item.description}
                </span>
                <span className="text-meta text-ink-subtle">{item.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
