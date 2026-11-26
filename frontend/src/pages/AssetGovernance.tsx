/**
 * Unified asset governance view (redesign Phase 5).
 *
 * One screen answers one question for one authorized asset: what is the current
 * governance state, what decision can be recorded, and what evidence supports
 * it. Hierarchy is counts → decision → evidence → provenance and caveats.
 *
 * Every value is labelled by origin — observed source metadata, system
 * proposal, assessment, or human decision. Missing values stay unknown.
 * Recording a decision executes no file operation: no archive, restore, move
 * or delete exists anywhere in this product.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, toErrorMessage } from "../api/client";
import { fetchAssetGovernance } from "../api/governance";
import { assessAsset, createDecision, listSupersessionCandidates } from "../api/retention";
import type {
  Assessment,
  Decision,
  DecisionValue,
  GovernanceDetail,
  GovernanceProvenance,
  GovernanceReviewContext,
  Hold,
  QualityFinding,
} from "../api/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { Textarea } from "../components/ui/Textarea";
import { TONE_SURFACE } from "../components/ui/statusClasses";
import { IconChevronRight, IconHold, IconRefresh, StatusIcon } from "../components/icons";
import { formatBytes, formatDate, humanize } from "../lib/format";
import {
  statusLabel,
  toneForConfidence,
  toneForDecision,
  toneForHoldStatus,
  toneForRecommendation,
  toneForSeverity,
  type StatusTone,
} from "../lib/semantic";

const DECISION_OPTIONS: Array<{ value: DecisionValue; label: string }> = [
  { value: "retain", label: "Retain" },
  { value: "request_more_information", label: "Request more information" },
  { value: "approve_for_later_workflow", label: "Approve recommendation for a later workflow" },
  { value: "reject", label: "Reject recommendation" },
];

const PRIMARY_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-control-x py-control-y text-body font-medium text-on-accent transition-colors hover:bg-accent-hover";
const SECONDARY_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-control bg-surface px-control-x py-control-y text-body font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-hover";

/** A status panel whose glyph, surface and ink all come from the one tone table. */
function Notice({
  tone,
  title,
  children,
}: {
  tone: StatusTone;
  title: string;
  children?: ReactNode;
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

/** One observed or proposed value in a definition list. */
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
    </div>
  );
}

export default function AssetGovernance() {
  const params = useParams();
  const assetId = Number(params.assetId);

  if (!Number.isInteger(assetId) || assetId <= 0) {
    return (
      <div>
        <PageHeader title="Asset Governance" />
        <ErrorState title="Invalid asset id" message="The asset id must be a positive integer." />
      </div>
    );
  }

  return <GovernanceView assetId={assetId} />;
}

function GovernanceView({ assetId }: { assetId: number }) {
  const { activeInstitutionId, has } = useAuth();
  const { data, loading, error, refetch } = useApiQuery(
    (signal) => fetchAssetGovernance(assetId, activeInstitutionId ?? undefined, signal),
    [assetId, activeInstitutionId],
  );

  const decisionOpen =
    data !== null &&
    data.review_context.latest_assessment_id !== null &&
    has("review:decide") &&
    !data.decisions.some(
      (item) => item.assessment_id === data.review_context.latest_assessment_id,
    );

  return (
    <div className="space-y-gutter">
      <PageHeader
        title={`Asset Governance — #${assetId}`}
        description="Consolidated governance context for one asset: source and discovery, classification and data quality, applicable policy and version, retention assessment, holds, and the append-only record of human decisions. Nothing here archives, restores, moves, or deletes a file."
        actions={
          data ? (
            <div className="flex flex-wrap items-center gap-2">
              {decisionOpen ? (
                <a href="#review-decision" className={PRIMARY_LINK}>
                  Review decision
                  <IconChevronRight className="h-4 w-4" />
                </a>
              ) : null}
              {has("retention:read") ? (
                <Link to={`/assessments/${assetId}`} className={SECONDARY_LINK}>
                  Assessment detail
                </Link>
              ) : null}
              <Button
                variant="ghost"
                onClick={refetch}
                disabled={loading}
                className="gap-1.5"
              >
                <IconRefresh className="h-4 w-4" />
                Refresh view
              </Button>
            </div>
          ) : undefined
        }
      />

      {loading && data === null ? <Spinner label="Loading governance view..." /> : null}
      {error ? (
        <ErrorState title="Governance view unavailable" message={error} onRetry={refetch} />
      ) : null}

      {data ? <GovernanceContent detail={data} onChanged={refetch} /> : null}
    </div>
  );
}

function GovernanceContent({
  detail,
  onChanged,
}: {
  detail: GovernanceDetail;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-gutter">
      <MetricLedger
        metrics={[
          {
            label: "Active holds",
            value: detail.active_holds.length,
            hint: "Block lifecycle-advancing decisions",
          },
          {
            label: "Quality findings",
            value: detail.quality_findings.length,
            hint: "Deterministic metadata checks",
          },
          {
            label: "Assessments",
            value: detail.assessment_history.length,
            hint: "Immutable, versioned entries",
          },
          {
            label: "Human decisions",
            value: detail.decisions.length,
            hint: "Append-only record",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
        <CurrentStateCard detail={detail} className="xl:col-span-3" />
        <ReviewDecisionCard detail={detail} onRecorded={onChanged} className="xl:col-span-2" />
      </div>

      <div className="space-y-stack">
        <p className="text-section font-semibold text-ink">Evidence behind the state</p>
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
          <PolicyCard detail={detail} />
          <AssessmentEvidenceCard detail={detail} onChanged={onChanged} />
          <HoldsCard detail={detail} />
          <ClassificationCard detail={detail} />
          <QualityCard detail={detail} />
          <SourceCard detail={detail} />
          <InventoryCard detail={detail} />
        </div>
      </div>

      <DecisionHistoryCard
        decisions={detail.decisions}
        effectiveDecisionId={detail.effective_decision_id}
      />
      <ProvenanceCard provenance={detail.provenance} />
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
      aria-labelledby="governance-metrics"
      className="overflow-hidden rounded-card border border-line bg-line shadow-card"
    >
      <h2 id="governance-metrics" className="sr-only">
        Governance at a glance
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

/* --------------------------- current state and decision -------------------- */

function CurrentStateCard({
  detail,
  className,
}: {
  detail: GovernanceDetail;
  className?: string;
}) {
  const latest = detail.latest_assessment;
  const governing = [...detail.decisions]
    .filter((item) => item.id === detail.effective_decision_id)
    .at(0);

  return (
    <Card className={className}>
      <CardHeader
        title="Current state & decision"
        description="Advisory recommendation and the human outcome that governs this asset."
        action={
          latest ? (
            <Badge tone={toneForRecommendation(latest.recommendation)}>
              {statusLabel(latest.recommendation)}
            </Badge>
          ) : undefined
        }
      />
      <CardBody className="space-y-stack">
        {latest ? (
          <p className="text-body text-ink-secondary">{latest.rationale}</p>
        ) : (
          <EmptyState
            title="No assessment recorded"
            message="Run an assessment to produce the first explainable retention recommendation. A decision without an assessment would have no version context to audit."
          />
        )}

        {detail.active_holds.length > 0 ? (
          <Notice
            tone="critical"
            title={`${detail.active_holds.length} active hold${
              detail.active_holds.length === 1 ? "" : "s"
            } block approving a lifecycle-advancing recommendation`}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconHold className="h-3.5 w-3.5" />
              Retain, request more information, or reject remain available.
            </span>
          </Notice>
        ) : null}

        {governing ? (
          <div className="rounded-control border border-line bg-surface-sunken px-card-x py-stack">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneForDecision(governing.decision)}>
                {statusLabel(governing.decision)}
              </Badge>
              <span className="text-meta text-ink-muted">Governing human decision</span>
            </div>
            <p className="mt-1.5 text-body text-ink-secondary">{governing.reason}</p>
            <p className="mt-1 text-meta text-ink-muted">
              {governing.reviewer} · {formatDate(governing.decided_at.slice(0, 10))} · assessment #
              {governing.assessment_id}
            </p>
          </div>
        ) : (
          <p className="text-supporting text-ink-muted">
            No human decision has been recorded for this asset yet.
          </p>
        )}

        <p className="text-meta text-ink-muted">
          A recorded decision executes nothing: this product has no archive, restore, move or
          delete operation. Approval endorses a recommendation for a later, separately authorized
          workflow only.
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------ review decision --------------------------- */

function ReviewDecisionCard({
  detail,
  onRecorded,
  className,
}: {
  detail: GovernanceDetail;
  onRecorded: () => void;
  className?: string;
}) {
  const { has, user } = useAuth();
  const context = detail.review_context;

  if (context.latest_assessment_id === null) {
    return (
      <Card className={className}>
        <CardHeader
          title="Record a review decision"
          description="A decision always references a specific assessment and policy version."
        />
        <CardBody>
          <EmptyState
            title="No assessment to decide on"
            message="Run an assessment for this asset first. A decision without an assessment would have no version context to audit."
          />
        </CardBody>
      </Card>
    );
  }

  if (!has("review:decide")) {
    return (
      <Card className={className}>
        <CardHeader
          title="Record a review decision"
          description="Recording decisions is restricted to the reviewer role."
        />
        <CardBody>
          <EmptyState
            title="Your role cannot record decisions"
            message={`Your account holds the ${
              user?.role ?? "no"
            } role. A platform administrator can grant the reviewer role; until then this view stays read-only. The server enforces this too, so it is not only a UI restriction.`}
          />
        </CardBody>
      </Card>
    );
  }

  // One decision per assessment: the form is available exactly when the
  // *latest* assessment has not been decided yet. Earlier decisions elsewhere
  // in the history are handled as corrections (supersession) inside the form.
  const decidedLatestAssessment = detail.decisions.some(
    (item) => item.assessment_id === context.latest_assessment_id,
  );
  if (decidedLatestAssessment) {
    return (
      <Card className={className}>
        <CardHeader title="Record a review decision" />
        <CardBody>
          <EmptyState
            title="A decision is already recorded for this assessment"
            message="Decisions are append-only and each assessment has exactly one. To change the outcome, run a fresh assessment above and record the correction against it — the new decision supersedes the earlier one, which stays visible in the history. Nothing is edited or deleted."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <DecisionForm
      detail={detail}
      context={context}
      onRecorded={onRecorded}
      className={className}
    />
  );
}

function DecisionForm({
  detail,
  context,
  onRecorded,
  className,
}: {
  detail: GovernanceDetail;
  context: GovernanceReviewContext;
  onRecorded: () => void;
  className?: string;
}) {
  const assessmentId = context.latest_assessment_id as number;
  const holdsActive = detail.active_holds.length;
  const { user } = useAuth();

  const [decision, setDecision] = useState<DecisionValue>("retain");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  // Earlier decisions this new one may replace. The server computes the list,
  // so the form can only offer real, already-authorized correction targets.
  const candidates = useApiQuery(
    (signal) => listSupersessionCandidates(assessmentId, signal),
    [assessmentId],
  );
  const options = candidates.data ?? [];

  // Untouched until the reviewer chooses, or until the eligible predecessors
  // load and the current effective decision can be pre-selected.
  const [supersedes, setSupersedes] = useState<string | null>(null);
  useEffect(() => {
    if (supersedes !== null || options.length === 0) {
      return;
    }
    // Correcting the effective decision is the expected correction; a reviewer
    // can still choose "independent decision" explicitly.
    const effective = options.find((item) => item.id === detail.effective_decision_id);
    setSupersedes(effective ? String(effective.id) : "");
  }, [supersedes, options, detail.effective_decision_id]);

  const supersedesId = supersedes !== null && supersedes !== "" ? Number(supersedes) : null;
  // A correction is a change of outcome, so it needs a substantive rationale
  // just like a rejection (the backend enforces the same rule).
  const requiresSubstantiveReason =
    decision === "reject" ||
    decision === "request_more_information" ||
    supersedesId !== null;
  const reasonTooShort = requiresSubstantiveReason && reason.trim().length < 10;
  const canSubmit =
    user !== null && reason.trim().length > 0 && !reasonTooShort && !submitting;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setConflict(null);
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      await createDecision(assessmentId, {
        decision,
        reason: reason.trim(),
        supersedes_decision_id: supersedesId,
        expected_assessed_at: context.expected_assessed_at,
        expected_policy_version_id: context.expected_policy_version_id,
        expected_holds_active: context.expected_holds_active,
      });
      setReason("");
      onRecorded();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(toErrorMessage(cause));
      } else {
        setError(toErrorMessage(cause));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const conflictTitle = conflict?.startsWith("stale_review_conflict")
    ? "This review is out of date"
    : conflict?.startsWith("hold_conflict")
      ? "Blocked by an active hold"
      : "Conflict";

  return (
    <Card className={className}>
      <CardHeader
        title="Record a review decision"
        description="A human decision, recorded against the exact assessment and policy version shown. It executes nothing: approval endorses a recommendation for a later, separately authorized workflow only."
      />
      <CardBody>
        {conflict ? (
          <div
            role="alert"
            className="mb-stack rounded-control border border-warning-line bg-warning-surface px-card-x py-stack text-supporting text-warning-ink"
          >
            <p className="font-semibold">{conflictTitle}</p>
            <p className="mt-1">{conflict}</p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onRecorded}>
                Reload governance view
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-stack">
            <ErrorState title="Decision not recorded" message={error} />
          </div>
        ) : null}

        <div className="mb-stack rounded-control border border-line bg-surface-sunken px-card-x py-stack text-meta text-ink-secondary">
          <p className="font-medium text-ink">Deciding against assessment #{assessmentId}</p>
          <p className="mt-1">
            Assessed{" "}
            {context.expected_assessed_at
              ? formatDate(context.expected_assessed_at.slice(0, 10))
              : "unknown"}{" "}
            · policy version{" "}
            {context.expected_policy_version_id !== null
              ? `#${context.expected_policy_version_id}`
              : "none"}{" "}
            · active holds at load {context.expected_holds_active ?? 0}. If any of these changed,
            the submission is rejected as stale so no decision is recorded against the wrong
            version.
          </p>
        </div>

        {holdsActive > 0 ? (
          <div className="mb-stack">
            <Notice
              tone="critical"
              title={`${holdsActive} active hold${
                holdsActive === 1 ? "" : "s"
              } block approving a lifecycle-advancing recommendation`}
            />
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-stack">
          <Field label="Decision">
            {(control) => (
              <Select
                {...control}
                value={decision}
                onChange={(event) => setDecision(event.target.value as DecisionValue)}
              >
                {DECISION_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === "approve_for_later_workflow" && holdsActive > 0}
                  >
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {options.length > 0 ? (
            <Field
              label="Correction"
              hint={
                supersedesId !== null
                  ? `Superseding decision #${supersedesId}: it stays in the history marked as superseded, and your decision becomes the effective one. A substantive rationale is required.`
                  : "Earlier decisions stay in the history; a superseded decision is marked and points at its replacement."
              }
            >
              {(control) => (
                <Select
                  {...control}
                  value={supersedes ?? ""}
                  onChange={(event) => setSupersedes(event.target.value)}
                >
                  <option value="">
                    Independent decision — does not replace any earlier decision
                  </option>
                  {options.map((option) => (
                    <option key={option.id} value={String(option.id)}>
                      Supersede decision #{option.id} — {statusLabel(option.decision)} on{" "}
                      {formatDate(option.decided_at.slice(0, 10))} (assessment #
                      {option.assessment_id})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field
            label="Rationale"
            hint={
              reasonTooShort
                ? "A rejection, request for more information, or correction needs a substantive rationale (at least 10 characters)."
                : "Recorded with the decision; it is not copied into the audit log."
            }
          >
            {(control) => (
              <Textarea
                {...control}
                invalid={reasonTooShort}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="Explain the reasoning behind this decision."
              />
            )}
          </Field>

          <div className="rounded-control border border-line bg-surface-sunken px-card-x py-stack text-meta text-ink-secondary">
            <p className="font-medium text-ink">Reviewer</p>
            <p className="mt-1">
              Recorded as{" "}
              <span className="font-medium text-ink">{user !== null ? (user.display_name || user.email) : "unknown"}</span>
              {user !== null ? ` (${user.email})` : ""}. This identity was verified by the server
              from your signed-in session — it is not typed in here, and it cannot be edited from
              this form.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={submitting} disabled={!canSubmit}>
              {submitting ? "Recording..." : "Record decision"}
            </Button>
            <span className="text-meta text-ink-muted">No file operation is performed.</span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* --------------------------------- evidence -------------------------------- */

function PolicyCard({ detail }: { detail: GovernanceDetail }) {
  const policy = detail.applicable_policy;
  return (
    <Card>
      <CardHeader
        title="Applicable policy & version"
        description="The single active policy that matches this asset, and the exact immutable version that applies. A missing policy never implies disposal."
      />
      <CardBody>
        {policy === null ? (
          <EmptyState
            title="No applicable policy"
            message="No active policy matches this asset. Missing policy coverage is an explicit gap: it never authorizes disposal, and retention review is required."
          />
        ) : (
          <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
            <DetailField label="Policy" value={`${policy.name} (${policy.status})`} />
            <DetailField
              label="Version"
              value={
                policy.version_id !== null
                  ? `#${policy.version_id}${
                      policy.version_number !== null ? ` (v${policy.version_number})` : ""
                    }`
                  : "none"
              }
            />
            <DetailField
              label="Retention period"
              value={
                policy.retention_period_days !== null
                  ? `${policy.retention_period_days} days`
                  : "unspecified"
              }
            />
            <DetailField label="Trigger" value={policy.retention_trigger ?? "unspecified"} />
            <DetailField
              label="Recommended action"
              value={policy.recommended_action ?? "unspecified"}
            />
            <DetailField
              label="Categories"
              value={
                policy.applicable_categories && policy.applicable_categories.length > 0
                  ? policy.applicable_categories.join(", ")
                  : "any"
              }
            />
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

function AssessmentEvidenceCard({
  detail,
  onChanged,
}: {
  detail: GovernanceDetail;
  onChanged: () => void;
}) {
  const { has } = useAuth();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const assessment = detail.latest_assessment;

  async function runAssessment(): Promise<void> {
    setRunning(true);
    setRunError(null);
    try {
      await assessAsset(detail.asset.id);
      onChanged();
    } catch (cause) {
      setRunError(toErrorMessage(cause));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Retention assessment (system proposal)"
        description="Each immutable entry records the policy version, findings and holds that applied. Re-running stores a new entry."
        action={
          has("retention:assess") ? (
            <Button
              variant="secondary"
              size="sm"
              loading={running}
              onClick={() => void runAssessment()}
            >
              {running ? "Assessing..." : "Run assessment"}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-stack">
        {runError ? (
          <ErrorState
            title="Assessment failed"
            message={runError}
            onRetry={() => void runAssessment()}
          />
        ) : null}

        {assessment === null ? (
          <EmptyState
            title="No assessment recorded"
            message="Run an assessment to produce the first explainable retention recommendation for this asset."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneForRecommendation(assessment.recommendation)}>
                {statusLabel(assessment.recommendation)}
              </Badge>
              <span className="text-meta text-ink-muted">
                {assessment.rule_set} · assessed {formatDate(assessment.assessed_at.slice(0, 10))}
              </span>
            </div>
            <p className="text-body text-ink-secondary">{assessment.rationale}</p>
            <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
              <DetailField
                label="Policy version"
                value={
                  assessment.policy_version_id !== null
                    ? `#${assessment.policy_version_id}${
                        assessment.policy_version_number !== null
                          ? ` (v${assessment.policy_version_number})`
                          : ""
                      }`
                    : "none"
                }
              />
              <DetailField
                label="Retention deadline"
                value={
                  assessment.retention_deadline
                    ? formatDate(assessment.retention_deadline)
                    : "not set"
                }
              />
              <DetailField
                label="Holds at assessment time"
                value={String(assessment.holds_active)}
              />
              <DetailField label="Rule set" value={assessment.rule_set} />
            </dl>
            {assessment.findings.length === 0 ? (
              <p className="text-supporting text-ink-muted">
                No findings were recorded on this assessment; eligibility is never assumed.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line">
                {assessment.findings.map((finding, index) => (
                  <li key={`${finding.code}-${index}`} className="px-card-x py-stack">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneForSeverity(finding.severity)}>
                        {statusLabel(finding.severity)}
                      </Badge>
                      <code className="font-mono text-meta text-ink-secondary">
                        {finding.code}
                      </code>
                    </div>
                    <p className="mt-1 text-supporting text-ink-secondary">{finding.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {detail.assessment_history.length > 1 ? (
          <AssessmentHistory assessments={detail.assessment_history} />
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Immutable assessment entries are history, not editable state. */
function AssessmentHistory({ assessments }: { assessments: Assessment[] }) {
  return (
    <section className="space-y-stack" aria-labelledby="assessment-history-title">
      <h3 id="assessment-history-title" className="text-section font-semibold text-ink">
        History ({assessments.length})
      </h3>
      <Table caption="Assessment history">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Assessed</TableHeaderCell>
            <TableHeaderCell>Recommendation</TableHeaderCell>
            <TableHeaderCell>Rule set</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {assessments.map((assessment, index) => (
            <TableRow key={`${assessment.assessed_at}-${index}`}>
              <TableCell>{formatDate(assessment.assessed_at.slice(0, 10))}</TableCell>
              <TableCell>
                <Badge tone={toneForRecommendation(assessment.recommendation)}>
                  {statusLabel(assessment.recommendation)}
                </Badge>
              </TableCell>
              <TableCell>{assessment.rule_set}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function ClassificationCard({ detail }: { detail: GovernanceDetail }) {
  const result = detail.classification;
  return (
    <Card>
      <CardHeader
        title="Classification (system proposal)"
        description="A deterministic, explainable proposal computed from inventoried metadata only. It is advisory and is never applied to the source record automatically."
      />
      <CardBody className="space-y-stack">
        {result === null ? (
          <EmptyState
            title="Not classified"
            message="No classification proposal has been recorded for this asset. An unclassified asset is an explicit unknown, never a low-risk one."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{humanize(result.outcome)}</Badge>
              <Badge tone={toneForConfidence(result.confidence)}>
                confidence {result.confidence}
              </Badge>
              <span className="text-meta text-ink-muted">
                {result.rule_version} · {formatDate(result.classified_at.slice(0, 10))}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
              <DetailField
                label="Proposed category"
                value={result.proposed_category ?? "unclassified"}
              />
              <DetailField
                label="Proposed sensitivity"
                value={humanize(result.proposed_sensitivity)}
              />
            </dl>
            <p className="text-body text-ink-secondary">{result.confidence_meaning}</p>
            {result.warnings.length > 0 ? (
              <Notice tone="warning" title={`${result.warnings.length} warning${
                result.warnings.length === 1 ? "" : "s"
              } recorded`} />
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function QualityCard({ detail }: { detail: GovernanceDetail }) {
  const findings = detail.quality_findings;
  return (
    <Card>
      <CardHeader
        title="Data quality & remediation"
        description="Deterministic metadata checks with suggested remediation. A finding describes metadata, never a file."
      />
      <CardBody>
        {findings.length === 0 ? (
          <EmptyState
            title="No quality findings"
            message="Every documented check passed for this asset. That does not prove the metadata is complete or correct."
          />
        ) : (
          <QualityList findings={findings} />
        )}
      </CardBody>
    </Card>
  );
}

function QualityList({ findings }: { findings: QualityFinding[] }) {
  return (
    <ul className="divide-y divide-line rounded-control border border-line">
      {findings.map((finding, index) => (
        <li key={`${finding.check}-${index}`} className="px-card-x py-stack">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneForSeverity(finding.severity)}>{finding.severity}</Badge>
            <code className="font-mono text-meta text-ink-secondary">{finding.check}</code>
          </div>
          <p className="mt-1 text-supporting text-ink-secondary">{finding.message}</p>
          <p className="mt-1 text-meta text-ink-muted">Remediation: {finding.remediation}</p>
        </li>
      ))}
    </ul>
  );
}

function SourceCard({ detail }: { detail: GovernanceDetail }) {
  const { source } = detail;
  return (
    <Card>
      <CardHeader
        title="Source & discovery"
        description="Where the record came from and when it was last observed. Scan results describe discovery, not a file operation."
      />
      <CardBody className="space-y-stack">
        <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
          <DetailField label="Data source" value={source.data_source_name ?? "unavailable"} />
          <DetailField label="Source type" value={source.source_type ?? "unknown"} />
          <DetailField label="Connector" value={source.connector_type ?? "unavailable"} />
        </dl>

        {source.notes.length > 0 ? (
          <Notice tone="warning" title="Source notes">
            <ul className="list-disc space-y-1 pl-card-x">
              {source.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {source.mappings.length > 0 ? (
          <div>
            <p className="text-supporting font-medium text-ink">
              Source-record mappings ({source.mappings.length})
            </p>
            <ul className="mt-1 divide-y divide-line rounded-control border border-line">
              {source.mappings.map((mapping) => (
                <li key={mapping.mapping_id} className="px-card-x py-stack">
                  <code className="font-mono text-meta text-ink-secondary">
                    {mapping.source_key}
                  </code>
                  <p className="mt-0.5 text-meta text-ink-muted">
                    observed {mapping.observation_count}× · last seen{" "}
                    {mapping.last_seen_at
                      ? formatDate(mapping.last_seen_at.slice(0, 10))
                      : "unknown"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {source.latest_scan ? (
          <div className="rounded-control border border-line bg-surface-sunken px-card-x py-stack text-meta text-ink-secondary">
            <span className="font-medium text-ink">
              Latest scan #{source.latest_scan.scan_job_id}
            </span>{" "}
            · status {source.latest_scan.status} · discovered {source.latest_scan.total_discovered} ·
            imported {source.latest_scan.total_imported} · skipped {source.latest_scan.total_skipped}
          </div>
        ) : (
          <p className="text-supporting text-ink-muted">
            No discovery run is recorded for this source; the asset may have been created directly.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function InventoryCard({ detail }: { detail: GovernanceDetail }) {
  const { asset } = detail;
  return (
    <Card>
      <CardHeader
        title="Inventory metadata (observed)"
        description="Values as recorded from the source. Missing metadata is shown as unknown and never treated as low risk."
      />
      <CardBody className="space-y-stack">
        <div>
          <p className="text-section font-semibold text-ink">{asset.title}</p>
          {asset.description ? (
            <p className="mt-1 text-supporting text-ink-secondary">{asset.description}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
          <DetailField label="External id" value={asset.external_id} />
          <DetailField label="Record type" value={asset.record_type} />
          <DetailField label="Category" value={asset.category ?? "unknown"} />
          <DetailField label="Sensitivity" value={humanize(asset.sensitivity)} />
          <DetailField
            label="Contains personal data"
            value={asset.contains_personal_data ? "Yes" : "No"}
          />
          <DetailField label="Lifecycle status" value={humanize(asset.lifecycle_status)} />
          <DetailField label="File name" value={asset.file_name ?? "unknown"} />
          <DetailField label="MIME type" value={asset.mime_type ?? "unknown"} />
          <DetailField
            label="Size"
            value={asset.size_bytes > 0 ? formatBytes(asset.size_bytes) : "unknown"}
          />
          <DetailField label="Owner team" value={asset.owner_team ?? "unassigned"} />
          <DetailField
            label="Checksum"
            value={asset.checksum_sha256 ? `${asset.checksum_sha256.slice(0, 16)}…` : "unknown"}
          />
          <DetailField
            label="Last reviewed"
            value={asset.last_reviewed ? formatDate(asset.last_reviewed) : "never"}
          />
        </dl>
      </CardBody>
    </Card>
  );
}

function HoldsCard({ detail }: { detail: GovernanceDetail }) {
  const holds: Hold[] = detail.active_holds;
  return (
    <Card>
      <CardHeader
        title="Active holds"
        description="A hold overrides incompatible lifecycle recommendations. Releasing a hold never rewrites history."
      />
      <CardBody>
        {holds.length === 0 ? (
          <p className="text-supporting text-ink-muted">No active holds block this asset.</p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {holds.map((hold) => (
              <li key={hold.id} className="px-card-x py-stack">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneForHoldStatus(hold.status)}>{hold.status}</Badge>
                  <span className="font-medium text-ink">{hold.name}</span>
                </div>
                <p className="mt-1 text-meta text-ink-muted">
                  {hold.hold_type ?? "hold"}
                  {hold.legal_basis ? ` · ${hold.legal_basis}` : ""}
                  {hold.asset_id === null ? " · institution-wide" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ----------------------------- decision history --------------------------- */

function DecisionHistoryCard({
  decisions,
  effectiveDecisionId,
}: {
  decisions: Decision[];
  effectiveDecisionId: number | null;
}) {
  return (
    <Card>
      <CardHeader
        title={`Review decisions (${decisions.length})`}
        description="Append-only history. A decision is never edited or erased: a superseded decision stays visible and points at the correction that replaced it. The effective decision is the newest one that has not been superseded."
      />
      <CardBody className="p-0">
        {decisions.length === 0 ? (
          <div className="px-card-x py-card-y">
            <p className="text-supporting text-ink-muted">
              No human decision has been recorded yet.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {decisions.map((decision) => (
              <li key={decision.id} className="px-card-x py-card-y">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneForDecision(decision.decision)}>
                    {statusLabel(decision.decision)}
                  </Badge>
                  {decision.id === effectiveDecisionId ? (
                    <Badge tone="success">Effective</Badge>
                  ) : null}
                  {decision.is_superseded ? <Badge tone="warning">Superseded</Badge> : null}
                  <span className="text-meta text-ink-muted">
                    reviewer {decision.reviewer} · {formatDate(decision.decided_at.slice(0, 10))} ·
                    assessment #{decision.assessment_id}
                  </span>
                </div>
                <p className="mt-1.5 text-body text-ink-secondary">{decision.reason}</p>
                <p className="mt-1 text-meta text-ink-muted">
                  Reviewed recommendation: {statusLabel(decision.recommendation_reviewed)}
                  {decision.policy_version_id !== null
                    ? ` · policy version #${decision.policy_version_id}`
                    : ""}
                </p>
                {decision.supersedes_decision_id !== null ? (
                  <p className="mt-1 text-meta text-accent-ink">
                    Corrects decision #{decision.supersedes_decision_id}; the earlier decision stays
                    in this history.
                  </p>
                ) : null}
                {decision.superseded_by_decision_id !== null ? (
                  <p className="mt-1 text-meta text-warning-ink">
                    Superseded by decision #{decision.superseded_by_decision_id}.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------- provenance ------------------------------ */

function ProvenanceCard({ provenance }: { provenance: GovernanceProvenance }) {
  return (
    <Card>
      <CardHeader
        title="Provenance & limitations"
        description="Each value on this screen is labelled by where it came from. Nothing here acts on a file."
      />
      <CardBody className="space-y-stack">
        <dl className="grid grid-cols-1 gap-stack text-supporting sm:grid-cols-2 xl:grid-cols-4">
          <DetailField
            label="Observed source metadata"
            value={provenance.observed.join(", ") || "—"}
          />
          <DetailField
            label="System proposals"
            value={provenance.system_proposed.join(", ") || "none recorded"}
          />
          <DetailField
            label="Assessments"
            value={provenance.assessed.join(", ") || "none recorded"}
          />
          <DetailField
            label="Human decisions"
            value={provenance.human_decisions.join(", ") || "none recorded"}
          />
        </dl>
        <p className="rounded-control border border-line bg-surface-sunken px-card-x py-stack text-supporting text-ink-secondary">
          File operations: {provenance.file_operations}
        </p>
      </CardBody>
    </Card>
  );
}
