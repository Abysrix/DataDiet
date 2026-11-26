/**
 * Asset assessment detail (redesign Phase 5).
 *
 * One job: explain one asset's retention assessment. The screen reads counts
 * first, then the recommendation, then the rule evidence and the immutable
 * history, and it ends with the caveat that an assessment executes nothing.
 *
 * Roles granted `retention:assess` see a "Run assessment" button; the POST is
 * issued only when they press it, never merely by opening the page. Other roles
 * see the history read-only and no assessment POST is issued. The permission
 * check is a usability gate — the backend re-checks it and remains authoritative.
 */

import { useCallback, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toErrorMessage } from "../api/client";
import { assessAsset, getAssessmentHistory } from "../api/retention";
import type { Assessment } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useApiQuery, type ApiQueryState } from "../hooks/useApiQuery";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { TONE_SURFACE } from "../components/ui/statusClasses";
import { IconChevronRight, IconHold, IconRefresh, StatusIcon } from "../components/icons";
import { formatDate } from "../lib/format";
import {
  statusLabel,
  toneForRecommendation,
  toneForSeverity,
  type StatusTone,
} from "../lib/semantic";

const SECONDARY_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-control bg-surface px-control-x py-control-y text-body font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-hover";

/** A status panel: the glyph, surface and ink all come from the one tone table. */
function Notice({
  tone,
  title,
  children,
}: {
  tone: StatusTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-control px-card-x py-stack text-supporting ring-1 ring-inset ${TONE_SURFACE[tone]}`}
    >
      <StatusIcon tone={tone} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5">{children}</div> : null}
      </div>
    </div>
  );
}

function MetricLedger({
  metrics,
}: {
  metrics: Array<{ label: string; value: string | number; hint: string }>;
}) {
  return (
    <section
      aria-labelledby="assessment-metrics"
      className="overflow-hidden rounded-card border border-line bg-line shadow-card"
    >
      <h2 id="assessment-metrics" className="sr-only">
        Assessment at a glance
      </h2>
      <dl className="grid grid-cols-1 gap-px sm:grid-cols-3">
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

export default function AssetAssessment() {
  const params = useParams();
  const { has } = useAuth();
  const assetId = Number(params.assetId);

  if (!Number.isInteger(assetId) || assetId <= 0) {
    return (
      <div>
        <PageHeader title="Asset Assessment" />
        <ErrorState title="Invalid asset id" message="The asset id must be a positive integer." />
      </div>
    );
  }

  // The runner is a separate component so an account without the permission
  // never mounts the hook that issues a POST.
  return has("retention:assess") ? (
    <ReviewerAssessment assetId={assetId} />
  ) : (
    <ReadOnlyAssessment assetId={assetId} />
  );
}

function useAssessmentHistory(assetId: number): ApiQueryState<Assessment[]> {
  return useApiQuery((signal) => getAssessmentHistory(assetId, signal), [assetId]);
}

function ReviewerAssessment({ assetId }: { assetId: number }) {
  const history = useAssessmentHistory(assetId);
  const [freshAssessment, setFreshAssessment] = useState<Assessment | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // An assessment is an immutable write. It happens on an explicit user action,
  // never on mount or on a re-render, and cannot be cancelled client-side once
  // the server has accepted it.
  const run = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    try {
      const result = await assessAsset(assetId);
      setFreshAssessment(result);
      history.refetch();
    } catch (cause) {
      setRunError(toErrorMessage(cause));
    } finally {
      setRunning(false);
    }
  }, [assetId, history.refetch]);

  return (
    <AssessmentLayout
      assetId={assetId}
      history={history}
      freshAssessment={freshAssessment}
      headerAction={
        <Button
          variant="primary"
          loading={running}
          disabled={running}
          onClick={() => void run()}
        >
          <IconRefresh className="h-4 w-4" />
          Run assessment
        </Button>
      }
      runStatus={
        running ? (
          <Spinner label="Assessing asset..." />
        ) : runError ? (
          <ErrorState title="Assessment failed" message={runError} onRetry={() => void run()} />
        ) : null
      }
    />
  );
}

function ReadOnlyAssessment({ assetId }: { assetId: number }) {
  const { user } = useAuth();
  const history = useAssessmentHistory(assetId);

  return (
    <AssessmentLayout
      assetId={assetId}
      history={history}
      headerAction={
        <Badge tone="neutral">Read-only — assessment permission not held</Badge>
      }
      permissionNotice={
        <Card>
          <CardBody>
            <EmptyState
              title="Your role cannot run assessments"
              message={`Your account holds the ${user?.role ?? "no"} role, which does not include retention:assess, so no assessment was requested. Re-running an assessment stores a new history entry; previous entries are preserved even if policies or holds change. The server enforces this too, so it is not only a UI restriction.`}
            />
          </CardBody>
        </Card>
      }
    />
  );
}

interface AssessmentLayoutProps {
  assetId: number;
  history: ApiQueryState<Assessment[]>;
  freshAssessment?: Assessment | null;
  headerAction: ReactNode;
  runStatus?: ReactNode;
  permissionNotice?: ReactNode;
}

function AssessmentLayout({
  assetId,
  history,
  freshAssessment = null,
  headerAction,
  runStatus,
  permissionNotice,
}: AssessmentLayoutProps) {
  const { has } = useAuth();
  const recorded = history.data ?? [];
  const current = freshAssessment ?? recorded[0] ?? null;
  const fromFreshRun = freshAssessment !== null;

  const secondaryAction = has("governance:read") ? (
    <Link to={`/governance/assets/${assetId}`} className={SECONDARY_LINK}>
      Governance view
      <IconChevronRight className="h-4 w-4" />
    </Link>
  ) : null;

  return (
    <div className="space-y-gutter">
      <PageHeader
        title={`Assessment - asset #${assetId}`}
        description="Explainable retention assessment: findings, evidence, applicable policy version, and blocking holds. Recommendations are advisory only."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {headerAction}
            {secondaryAction}
          </div>
        }
      />

      {permissionNotice}
      {runStatus}
      {history.loading && history.data === null ? (
        <Spinner label="Loading assessment history..." />
      ) : null}
      {history.error ? (
        <ErrorState
          title="History unavailable"
          message={history.error}
          onRetry={history.refetch}
        />
      ) : null}

      {current ? (
        <>
          <MetricLedger
            metrics={[
              {
                label: "Findings",
                value: current.findings.length,
                hint: "Evidence entries on this assessment",
              },
              {
                label: "Active holds",
                value: current.holds_active,
                hint: "Holds recorded at assessment time",
              },
              {
                label: "History entries",
                value: recorded.length,
                hint: "Immutable assessments for this asset",
              },
            ]}
          />

          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
            <RecommendationCard assessment={current} fromFreshRun={fromFreshRun} className="xl:col-span-3" />
            <HistoryCard
              assetId={assetId}
              assessments={recorded}
              loading={history.loading}
              className="xl:col-span-2"
            />
          </div>

          <FindingsCard findings={current.findings} />

          <p className="text-meta text-ink-muted">
            Source: the server's assessment record for asset #{assetId} · rule set {current.rule_set}.
            An assessment is metadata-only and advisory: it never archives, restores, moves or
            deletes a file, and it is not a decision.
          </p>
        </>
      ) : history.error ? null : history.loading ? null : (
        <Card>
          <CardBody>
            <EmptyState
              title="No assessments recorded"
              message={
                has("retention:assess")
                  ? "Run an assessment above to record the first history entry. Previous entries are preserved even if policies or holds change."
                  : "No assessment has been recorded for this asset. Previous entries are preserved even if policies or holds change."
              }
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** The decision-level view: what the assessment says and what constrains it. */
function RecommendationCard({
  assessment,
  fromFreshRun,
  className,
}: {
  assessment: Assessment;
  fromFreshRun: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title={fromFreshRun ? "Latest recommendation" : "Latest recorded recommendation"}
        description={
          fromFreshRun
            ? "The assessment just recorded for this asset."
            : "Read from the immutable history; no new assessment was requested."
        }
        action={
          <Badge tone={toneForRecommendation(assessment.recommendation)}>
            {statusLabel(assessment.recommendation)}
          </Badge>
        }
      />
      <CardBody className="space-y-stack">
        <p className="text-body text-ink-secondary">{assessment.rationale}</p>

        {assessment.holds_active > 0 ? (
          <Notice
            tone="critical"
            title={`${assessment.holds_active} active hold${
              assessment.holds_active === 1 ? "" : "s"
            } block disposal`}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconHold className="h-3.5 w-3.5" />
              Blocking holds override incompatible lifecycle recommendations.
            </span>
          </Notice>
        ) : null}

        <dl className="grid grid-cols-1 gap-stack sm:grid-cols-3">
          <Detail label="Applicable policy" value={policyLabel(assessment)} />
          <Detail label="Policy version" value={policyVersionLabel(assessment)} />
          <Detail
            label="Unresolved conditions"
            value={
              assessment.unresolved_conditions.length > 0
                ? assessment.unresolved_conditions.join(", ")
                : "None"
            }
          />
        </dl>
      </CardBody>
    </Card>
  );
}

function policyLabel(assessment: Assessment): string {
  return assessment.policy_id !== null ? `#${assessment.policy_id}` : "None";
}

function policyVersionLabel(assessment: Assessment): string {
  if (assessment.policy_version_id === null) {
    return "None";
  }
  return assessment.policy_version_number !== null
    ? `#${assessment.policy_version_id} (v${assessment.policy_version_number})`
    : `#${assessment.policy_version_id}`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
    </div>
  );
}

/** Evidence: every finding carries a documented severity and its metadata. */
function FindingsCard({ findings }: { findings: Assessment["findings"] }) {
  return (
    <Card>
      <CardHeader
        title={`Findings (${findings.length})`}
        description="Rule codes, severity and the metadata evidence behind each finding."
      />
      <CardBody className="p-0">
        {findings.length === 0 ? (
          <div className="px-card-x py-card-y">
            <EmptyState
              title="No findings"
              message="This assessment produced no findings. That does not make the asset eligible for disposal; eligibility is never assumed."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {findings.map((finding, index) => (
              <li key={`${finding.code}-${index}`} className="px-card-x py-card-y">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneForSeverity(finding.severity)}>
                    {statusLabel(finding.severity)}
                  </Badge>
                  <code className="font-mono text-meta text-ink-secondary">{finding.code}</code>
                </div>
                <p className="mt-1.5 text-body text-ink-secondary">{finding.message}</p>
                {finding.evidence ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-control border border-line bg-surface-sunken p-stack font-mono text-meta text-ink-secondary">
                    {JSON.stringify(finding.evidence, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Append-only history: a table keeps date, outcome and version comparable. */
function HistoryCard({
  assetId,
  assessments,
  loading,
  className,
}: {
  assetId: number;
  assessments: Assessment[];
  loading: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title={`History (${assessments.length})`}
        description="Immutable entries; each keeps the policy version and findings that applied at assessment time."
        action={loading ? <span role="status" className="text-meta text-ink-muted">Refreshing…</span> : undefined}
      />
      <CardBody className="p-0">
        {assessments.length === 0 ? (
          <div className="px-card-x py-card-y">
            <EmptyState
              title="No recorded history"
              message="No immutable assessment entries are available for this asset yet."
            />
          </div>
        ) : (
          <Table caption={`Assessment history for asset ${assetId}`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Assessed</TableHeaderCell>
                <TableHeaderCell>Outcome</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Policy</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assessments.map((assessment, index) => (
                <TableRow key={`${assessment.assessed_at}-${index}`}>
                  <TableCell>
                    <time
                      dateTime={assessment.assessed_at.slice(0, 10)}
                      className="whitespace-nowrap tabular-nums"
                    >
                      {formatDate(assessment.assessed_at.slice(0, 10))}
                    </time>
                  </TableCell>
                  <TableCell>
                    <Badge tone={toneForRecommendation(assessment.recommendation)}>
                      {statusLabel(assessment.recommendation)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {policyVersionLabel(assessment)} · {assessment.rule_set}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
