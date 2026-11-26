/**
 * Risk analysis: stored, explainable assessments from the real API.
 *
 * The browser never computes a score. It reads rows produced by the documented
 * rule set, shows each contributing indicator, and exposes the same rule table
 * so a viewer can understand why a record scored as it did. There is no control
 * here to archive, dispose of, or change any record.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { getRiskRules, listRiskAssessments } from "../api/risk";
import type { RiskBand } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { FOCUS_RING } from "../components/ui/control";
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
import { IconChevronLeft, IconChevronRight, IconRefresh, IconShield } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";
import { formatDate, humanize } from "../lib/format";
import { toneForRiskBand } from "../lib/semantic";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;
const PER_PAGE = 20;
const BANDS: RiskBand[] = ["critical", "high", "moderate", "low"];

function RiskHeader() {
  return (
    <PageHeader
      title="Risk Analysis"
      description="Explainable indicators are read from assessments stored by the documented rule set. Every score shown here was computed by the API; this page does not calculate, edit or act on it."
      actions={<Badge tone="info">Live API</Badge>}
    />
  );
}

function RiskData({ institutionId }: { institutionId: number | null }) {
  const [page, setPage] = useState(1);
  const [band, setBand] = useState<RiskBand | "">("");

  const assessments = useApiQuery(
    (signal) =>
      listRiskAssessments(
        {
          page,
          per_page: PER_PAGE,
          band: band || undefined,
          institution_id: institutionId ?? undefined,
        },
        signal,
      ),
    [page, band, institutionId],
  );
  const rules = useApiQuery((signal) => getRiskRules(signal), []);

  return (
    <div className="space-y-gutter">
      <Card>
        <CardHeader
          title="Documented rule table"
          description="The exact indicators and severity bands behind every score below."
          action={rules.loading ? <span role="status" className="text-meta text-ink-muted">Loading rules…</span> : undefined}
        />
        <CardBody className="space-y-gutter">
          {rules.error ? (
            <ErrorState title="Rules unavailable" message={rules.error} onRetry={rules.refetch} />
          ) : null}
          {rules.data ? (
            <>
              <div className="flex flex-wrap gap-2">
                {rules.data.bands.map((item) => (
                  <Badge key={item.band} tone={toneForRiskBand(item.band)}>
                    {humanize(item.band)} {item.minimum}–{item.maximum}
                  </Badge>
                ))}
              </div>
              <Table caption={`Risk indicators in ${rules.data.rule_set}`}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">Indicator</TableHeaderCell>
                    <TableHeaderCell scope="col">Condition</TableHeaderCell>
                    <TableHeaderCell scope="col" align="right">
                      Points
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.data.rules.map((rule) => (
                    <TableRow key={rule.code}>
                      <TableCell className="font-medium text-ink">{rule.label}</TableCell>
                      <TableCell className="text-ink-secondary">{rule.condition}</TableCell>
                      <TableCell align="right" className="tabular-nums">
                        +{rule.points}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Stored assessments (${assessments.data?.total ?? 0})`}
          description={
            institutionId === null
              ? "Every institution this account can read, ordered by the stored score."
              : `Scoped to institution #${institutionId}, ordered by the stored score.`
          }
          action={
            <Button
              variant="secondary"
              onClick={assessments.refetch}
              className="gap-1.5"
              disabled={assessments.loading}
            >
              <IconRefresh className="h-4 w-4" />
              Refresh
            </Button>
          }
        />
        <CardBody className="flex flex-wrap items-end gap-4">
          <Field label="Risk band" className="w-full sm:w-56">
            {(control) => (
              <Select
                {...control}
                value={band}
                onChange={(event) => {
                  setBand(event.target.value as RiskBand | "");
                  setPage(1);
                }}
              >
                <option value="">All bands</option>
                {BANDS.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="max-w-prose text-meta text-ink-muted">
            Scores and explanations come from stored rows. Nothing in this view executes a
            lifecycle action.
          </p>
        </CardBody>

        {assessments.error ? (
          <CardBody>
            <ErrorState
              title="Risk assessments unavailable"
              message={assessments.error}
              onRetry={assessments.refetch}
            />
          </CardBody>
        ) : null}

        {assessments.loading && assessments.data === null ? (
          <CardBody>
            <Spinner label="Loading risk assessments…" />
          </CardBody>
        ) : null}

        {assessments.data?.items.length === 0 ? (
          <CardBody>
            <EmptyState
              title="No stored assessments"
              message={
                band
                  ? `No assessment in the current scope has the ${band} band. Clear the filter to see other stored scores.`
                  : "No assessment has been stored for this scope yet. No score is invented to fill the view."
              }
            />
          </CardBody>
        ) : null}

        {assessments.data && assessments.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <Table caption="Stored risk assessments">
              <TableHead>
                <TableRow>
                  <TableHeaderCell scope="col">Asset</TableHeaderCell>
                  <TableHeaderCell scope="col">Band</TableHeaderCell>
                  <TableHeaderCell scope="col" align="right">
                    Score
                  </TableHeaderCell>
                  <TableHeaderCell scope="col">Assessed</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {assessments.data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium text-ink">{item.asset_title}</p>
                      <p className="mt-0.5 font-mono text-meta text-ink-muted">
                        {item.external_id}
                      </p>
                      <details className="mt-2 text-meta text-ink-secondary">
                        <summary className="cursor-pointer text-accent-ink">
                          Why this score
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {item.indicators.length === 0 ? (
                            <li>No indicator contributed to this score.</li>
                          ) : (
                            item.indicators.map((indicator) => (
                              <li key={indicator.code}>{indicator.explanation}</li>
                            ))
                          )}
                        </ul>
                      </details>
                    </TableCell>
                    <TableCell>
                      <Badge tone={toneForRiskBand(item.band)}>{humanize(item.band)}</Badge>
                    </TableCell>
                    <TableCell align="right" className="font-semibold tabular-nums">
                      {item.score}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-ink-secondary">
                      {formatDate(item.assessed_at.slice(0, 10))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {assessments.data && assessments.data.pages > 1 ? (
          <CardBody className="flex items-center justify-between border-t border-line">
            <span className="text-meta text-ink-muted">
              Page {assessments.data.page} of {assessments.data.pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <IconChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= assessments.data.pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <IconChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * The permission and session gates run before the data component mounts, so a
 * refused request is never presented as a retryable data error.
 */
export default function RiskAnalysis() {
  const { status, has, activeInstitutionId } = useAuth();
  const canRead = has("inventory:read");

  return (
    <div className="space-y-gutter">
      <RiskHeader />

      {status === "loading" ? (
        <Card>
          <CardHeader
            title="Risk access"
            description="Checking the permissions the server verified for this session."
          />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      ) : null}

      {status === "anonymous" ? (
        <Card>
          <CardHeader
            title="Risk access"
            description="This screen needs a verified DataDiet session."
          />
          <CardBody>
            <EmptyState
              title="Sign in to view risk analysis"
              message="No identity has been verified for this browser, so no risk request was made."
              action={
                <Link to="/signin" className={LINK_CLASS}>
                  Go to sign in
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && !canRead ? (
        <Card>
          <CardHeader
            title="Risk data is not available to this account"
            description="The server-verified permissions for this session do not include inventory:read."
            action={<Badge tone="neutral">Permission required</Badge>}
          />
          <CardBody className="space-y-gutter">
            <div className="flex items-start gap-3 rounded-card border border-line bg-surface-sunken px-card-x py-card-y">
              <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
              <p className="text-supporting text-ink-secondary">
                The backend would refuse this request, so no request was made. This is shown as
                information, not as a disabled button or a retryable error.
              </p>
            </div>
            <p className="text-meta text-ink-muted">
              If this is unexpected, the account&apos;s directory permissions need to be reviewed
              outside this app. This page never grants or changes permissions.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && canRead ? (
        <RiskData institutionId={activeInstitutionId} />
      ) : null}
    </div>
  );
}
