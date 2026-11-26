import { useState } from "react";
import { Link } from "react-router-dom";
import { fetchRiskAnalysis } from "../api/demo";
import type { RiskBand, RiskRecordView, RiskRuleInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { DemoNotice } from "../components/ui/DemoNotice";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import { FOCUS_RING } from "../components/ui/control";
import { TONE_SOLID } from "../components/ui/statusClasses";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { IconChevronRight, IconShield } from "../components/icons";
import { humanize } from "../lib/format";
import { toneForRiskBand, toneForSensitivity, type Tone } from "../lib/semantic";

/**
 * Reads `GET /api/v1/demo/risk`, which returns one explainable assessment per
 * synthetic record plus the rule catalogue. The payload carries no aggregates:
 * every count, share and total on this page is computed here from `records`,
 * and each one names the denominator it used.
 */

/** Highest severity first — the point of the distribution is what to look at next. */
const BANDS: Array<{ band: RiskBand; label: string; range: string }> = [
  { band: "critical", label: "Critical", range: "75–100" },
  { band: "high", label: "High", range: "50–74" },
  { band: "moderate", label: "Moderate", range: "25–49" },
  { band: "low", label: "Low", range: "0–24" },
];

const MAX_SCORE = 100;
const ELEVATED_BANDS: RiskBand[] = ["critical", "high"];

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

function shareOf(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "—";
}

interface BandCount {
  band: RiskBand;
  label: string;
  range: string;
  count: number;
  tone: Tone;
}

function countByBand(records: readonly RiskRecordView[]): BandCount[] {
  return BANDS.map((entry) => ({
    ...entry,
    count: records.filter((record) => record.band === entry.band).length,
    tone: toneForRiskBand(entry.band),
  }));
}

interface CategoryStat {
  code: string;
  label: string;
  records: number;
  points: number;
}

/**
 * How much each documented indicator actually contributed across the returned
 * records. Counts and points come from `record.indicators`; the label is the
 * rule catalogue's own description, so the breakdown reads as the rule set
 * rather than as a new scoring model.
 */
function summarizeCategories(
  records: readonly RiskRecordView[],
  rules: readonly RiskRuleInfo[],
): CategoryStat[] {
  const stats = new Map<string, CategoryStat>();
  for (const record of records) {
    for (const indicator of record.indicators) {
      const current = stats.get(indicator.code) ?? {
        code: indicator.code,
        label: rules.find((rule) => rule.code === indicator.code)?.description ?? humanize(indicator.code),
        records: 0,
        points: 0,
      };
      current.records += 1;
      current.points += indicator.points;
      stats.set(indicator.code, current);
    }
  }
  return [...stats.values()].sort(
    (a, b) => b.points - a.points || b.records - a.records || a.code.localeCompare(b.code),
  );
}

function dominantIndicator(record: RiskRecordView): RiskRecordView["indicators"][number] | null {
  return record.indicators.reduce<RiskRecordView["indicators"][number] | null>(
    (highest, indicator) => (highest === null || indicator.points > highest.points ? indicator : highest),
    null,
  );
}

function RiskHeader() {
  return (
    <PageHeader
      title="Risk Analysis"
      description="Privacy and retention exposure for the synthetic sample set, scored by the documented indicator rules and explained indicator by indicator. These are exposure indicators, not a security rating, and they drive no automated decision."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">Synthetic sample</Badge>
          <Badge tone="neutral">Advisory only</Badge>
        </div>
      }
    />
  );
}

/**
 * The endpoint requires `inventory:read`. A client-side gate is usability only —
 * the backend re-checks every request — but it keeps a known refusal from being
 * presented as a retryable data error when no request was ever made.
 */
export default function RiskAnalysis() {
  const { status, has } = useAuth();

  if (status === "loading") {
    return (
      <div>
        <RiskHeader />
        <Card>
          <CardHeader
            title="Risk access"
            description="Checking the permissions the server verified for this session."
          />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <div>
        <RiskHeader />
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
      </div>
    );
  }

  if (!has("inventory:read")) {
    return (
      <div>
        <RiskHeader />
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
              outside this demo. This page never grants or changes permissions.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return <RiskAnalysisResults />;
}

function RiskAnalysisResults() {
  const { data, loading, error, refetch } = useApiQuery(fetchRiskAnalysis, []);

  return (
    <div>
      <RiskHeader />

      {loading ? <LoadingRisk /> : null}
      {error ? (
        <ErrorState title="Risk data unavailable" message={error} onRetry={refetch} />
      ) : null}

      {data ? (
        <>
          <DemoNotice notice={data.meta.notice} />
          <RiskContent
            ruleSet={data.data.rule_set}
            rules={data.data.rules}
            records={data.data.records}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * The first-load state: the shape of the exposure panel with its figures
 * withheld. It is deliberately static — no shimmer to imply progress — and
 * `role="status"` carries the announcement, so the bars are hidden from
 * assistive tech rather than read out as an unnamed region.
 */
function LoadingRisk() {
  return (
    <Card>
      <CardHeader
        title="Risk exposure summary"
        description="Loading the synthetic sample assessments."
      />
      <CardBody>
        <span role="status" className="sr-only">
          Loading risk assessments…
        </span>
        <div aria-hidden="true" className="space-y-6 py-2">
          <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="space-y-2">
                <div className="h-2.5 w-1/3 rounded-pill bg-surface-sunken" />
                <div className="h-6 w-1/2 rounded-pill bg-surface-sunken" />
              </div>
            ))}
          </div>
          <div className="h-2.5 w-full rounded-pill bg-surface-sunken" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-4">
                <div className="h-3 w-1/4 rounded-pill bg-surface-sunken" />
                <div className="h-3 flex-1 rounded-pill bg-surface-sunken" />
                <div className="h-3 w-16 rounded-pill bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RiskContent({
  ruleSet,
  rules,
  records,
}: {
  ruleSet: string;
  rules: RiskRuleInfo[];
  records: RiskRecordView[];
}) {
  const bandCounts = countByBand(records);
  const categories = summarizeCategories(records, rules);
  const totalPoints = categories.reduce((sum, category) => sum + category.points, 0);
  const elevated = bandCounts
    .filter((entry) => ELEVATED_BANDS.includes(entry.band))
    .reduce((sum, entry) => sum + entry.count, 0);
  const topScore = records.reduce((highest, record) => Math.max(highest, record.score), 0);
  const leading = categories[0];

  if (records.length === 0) {
    return (
      <div className="space-y-gutter">
        <Card>
          <CardHeader title="Assessed records" description={`Rule set: ${ruleSet}`} />
          <CardBody>
            <EmptyState
              title="No assessments in this sample set"
              message="The risk endpoint returned no records, so there is nothing to distribute, rank or explain. Assessments appear only when records are inventoried by a source scan."
            />
          </CardBody>
        </Card>
        <RuleCatalogue rules={rules} ruleSet={ruleSet} />
      </div>
    );
  }

  return (
    <div className="space-y-gutter">
      <ExposureSummary
        ruleSet={ruleSet}
        assessed={records.length}
        elevated={elevated}
        topScore={topScore}
        totalPoints={totalPoints}
        leading={leading ?? null}
      />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
        <SeverityDistribution
          bands={bandCounts}
          total={records.length}
          ruleSet={ruleSet}
          className="xl:col-span-3"
        />
        <WhereToStart records={records} ruleSet={ruleSet} className="xl:col-span-2" />
      </div>

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
        <CategoryBreakdown
          categories={categories}
          total={records.length}
          totalPoints={totalPoints}
          className="xl:col-span-3"
        />
        <RuleCatalogue rules={rules} ruleSet={ruleSet} className="xl:col-span-2" />
      </div>

      <AssessedRecords records={records} ruleSet={ruleSet} />
    </div>
  );
}

/**
 * The four figures a governance operator reads first, in one sentence-shaped
 * panel rather than four tiles: they only mean something together, and the
 * denominator is stated inside the panel so no share here is left ambiguous.
 */
function ExposureSummary({
  ruleSet,
  assessed,
  elevated,
  topScore,
  totalPoints,
  leading,
}: {
  ruleSet: string;
  assessed: number;
  elevated: number;
  topScore: number;
  totalPoints: number;
  leading: CategoryStat | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Risk exposure summary"
        description={`Every figure below is counted from the ${assessed} record${
          assessed === 1 ? "" : "s"
        } this endpoint returned — the payload supplies no aggregates of its own.`}
      />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          <SummaryItem
            label="Records assessed"
            value={String(assessed)}
            source="Counted from the returned records"
          />
          <SummaryItem
            label="High or Critical"
            value={`${elevated} (${shareOf(elevated, assessed)})`}
            source="Counted from band fields by the documented rule set"
          />
          <SummaryItem
            label="Highest score"
            value={`${topScore}/${MAX_SCORE}`}
            source={`Rule-set score, capped at ${MAX_SCORE}`}
          />
          <SummaryItem
            label="Indicator points contributed"
            value={String(totalPoints)}
            source="Sum of the returned indicator points"
          />
        </dl>

        {leading ? (
          <p className="text-supporting text-ink-secondary">
            The largest single contributor is{" "}
            <span className="font-medium text-ink">{leading.label}</span>, present on{" "}
            {leading.records} of {assessed} record{assessed === 1 ? "" : "s"} and worth{" "}
            {leading.points} point{leading.points === 1 ? "" : "s"} in this sample set.
          </p>
        ) : null}

        <p className="text-meta text-ink-subtle">
          Rule set <span className="font-mono">{ruleSet}</span>: score bands and the 100-point cap
          come from that rule set; counts and shares above are derived only from the returned
          records. This endpoint is not institution-scoped: the same synthetic sample set is
          returned for every institution scope, and changing the scope in the sidebar does not
          change these numbers.
        </p>
        <p className="text-meta text-ink-subtle">
          These records are in-process fixtures, not rows in the inventory database, so no record
          here opens an asset page.{" "}
          <Link to="/inventory" className={LINK_CLASS}>
            Open the inventory view
            <IconChevronRight className="h-3.5 w-3.5" />
            <span className="sr-only">for the assets stored in the inventory database</span>
          </Link>{" "}
          to see what the platform actually holds.
        </p>
      </CardBody>
    </Card>
  );
}

function SummaryItem({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd>
        <span className="block text-data font-semibold tabular-nums text-ink">{value}</span>
        <span className="mt-0.5 block text-meta text-ink-subtle">{source}</span>
      </dd>
    </div>
  );
}

function SeverityDistribution({
  bands,
  total,
  ruleSet,
  className,
}: {
  bands: BandCount[];
  total: number;
  ruleSet: string;
  className?: string;
}) {
  const present = bands.filter((band) => band.count > 0);

  return (
    <Card className={className}>
      <CardHeader
        title="Severity distribution"
        description={`Records per band, as a share of the ${total} assessed record${
          total === 1 ? "" : "s"
        }. Bands and score ranges come from rule set ${ruleSet}.`}
      />
      <CardBody className="space-y-4">
        {present.length > 0 ? (
          <div
            aria-hidden="true"
            className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill bg-surface-sunken"
          >
            {present.map((band) => (
              <div
                key={band.band}
                className={`h-full rounded-pill ${TONE_SOLID[band.tone]}`}
                style={{ flexGrow: band.count }}
              />
            ))}
          </div>
        ) : (
          <p className="text-supporting text-ink-muted">
            No record falls in any band, so the distribution is empty.
          </p>
        )}

        <Table caption="Records by risk band, with the share of assessed records">
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Band</TableHeaderCell>
              <TableHeaderCell scope="col">Score range</TableHeaderCell>
              <TableHeaderCell scope="col" align="right">
                Records
              </TableHeaderCell>
              <TableHeaderCell scope="col" align="right">
                Share
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bands.map((band) => (
              <TableRow key={band.band}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-pill ${TONE_SOLID[band.tone]}`}
                    />
                    <Badge tone={band.tone}>{band.label}</Badge>
                  </span>
                </TableCell>
                <TableCell className="tabular-nums text-ink-muted">{band.range}</TableCell>
                <TableCell align="right" className="font-medium tabular-nums text-ink">
                  {band.count}
                </TableCell>
                <TableCell align="right" className="tabular-nums text-ink-muted">
                  {shareOf(band.count, total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

/**
 * The records a High or Critical band actually puts in front of an operator.
 *
 * The order is the order the endpoint already returns (score, descending) —
 * nothing here re-ranks or predicts. There is no per-record link: these
 * assessments are computed over in-process fixtures that are not rows in the
 * inventory database, so a link to an asset page would lead nowhere.
 */
function WhereToStart({
  records,
  ruleSet,
  className,
}: {
  records: RiskRecordView[];
  ruleSet: string;
  className?: string;
}) {
  const elevated = records.filter((record) => ELEVATED_BANDS.includes(record.band));

  return (
    <Card className={className}>
      <CardHeader
        title="Where to start"
        description={
          elevated.length > 0
            ? `The ${elevated.length} record${
                elevated.length === 1 ? "" : "s"
              } in a High or Critical band, in the order the endpoint returns them. Scores and bands are rule-set results from ${ruleSet}.`
            : `No record in this sample set sits in a High or Critical band. Bands are defined by rule set ${ruleSet}.`
        }
      />
      <CardBody className="p-0">
        {elevated.length === 0 ? (
          <p className="px-card-x py-card-y text-supporting text-ink-muted">
            Nothing elevated right now: the highest score here is{" "}
            <span className="font-medium text-ink tabular-nums">
              {records.reduce((highest, record) => Math.max(highest, record.score), 0)}/{MAX_SCORE}
            </span>
            , a rule-set result. Expand the assessed records below to see what each score is made
            of.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {elevated.map((record) => {
              const driver = dominantIndicator(record);
              return (
                <li key={record.record_id} className="px-card-x py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 text-body font-medium text-ink">{record.title}</p>
                    <span className="text-data font-semibold tabular-nums text-ink">
                      {record.score}/{MAX_SCORE}
                    </span>
                    <Badge tone={toneForRiskBand(record.band)}>{humanize(record.band)}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-meta text-ink-muted">{record.record_id}</p>
                  <p className="mt-1 text-meta text-ink-subtle">
                    Score and band from rule set <span className="font-mono">{ruleSet}</span>;
                    score capped at {MAX_SCORE}.
                  </p>
                  {driver ? (
                    <p className="mt-1 text-meta text-ink-secondary">
                      Largest contributor: {driver.label} (+{driver.points})
                    </p>
                  ) : (
                    <p className="mt-1 text-meta text-ink-subtle">No indicator applied.</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function CategoryBreakdown({
  categories,
  total,
  totalPoints,
  className,
}: {
  categories: CategoryStat[];
  total: number;
  totalPoints: number;
  className?: string;
}) {
  const maxRecords = categories.reduce((highest, item) => Math.max(highest, item.records), 0);

  return (
    <Card className={className}>
      <CardHeader
        title="Risk categories by contribution"
        description={`Which documented indicators actually drive this sample set, counted over the same ${
          total === 1 ? "record" : `${total} records`
        }. Points are the catalogue's indicator weights, not a new score.`}
      />
      <CardBody>
        <Table caption="Indicator contribution: records affected and points contributed">
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Indicator</TableHeaderCell>
              {/* Header cells cannot wrap, so the caption spells these out. */}
              <TableHeaderCell scope="col">Records</TableHeaderCell>
              <TableHeaderCell scope="col" align="right">
                Points
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.code}>
                <TableCell>
                  <p className="font-medium text-ink">{category.label}</p>
                  <p className="mt-0.5 font-mono text-meta break-words text-ink-subtle">
                    {category.code}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="w-12 shrink-0 tabular-nums text-ink">
                      {category.records}/{total}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
                    >
                      <span
                        className="block h-full rounded-pill bg-accent"
                        style={{
                          width: `${maxRecords > 0 ? (category.records / maxRecords) * 100 : 0}%`,
                        }}
                      />
                    </span>
                  </span>
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  <span className="font-medium text-ink">+{category.points}</span>
                  <span className="ml-1.5 text-ink-muted">{shareOf(category.points, totalPoints)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-meta text-ink-subtle">
          Shares are of the {totalPoints} indicator point{totalPoints === 1 ? "" : "s"} contributed
          across all records. A record&apos;s own total is capped at {MAX_SCORE}, so category points
          are not a per-record score.
        </p>
      </CardBody>
    </Card>
  );
}

function RuleCatalogue({
  rules,
  ruleSet,
  className,
}: {
  rules: RiskRuleInfo[];
  ruleSet: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title="Indicator rules"
        description={`The documented rule set behind every score on this page (${ruleSet}).`}
      />
      <CardBody className="p-0">
        {rules.length === 0 ? (
          <p className="px-card-x py-card-y text-supporting text-ink-muted">
            The endpoint returned no rule definitions.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((rule) => (
              <li key={rule.code} className="px-card-x py-3">
                <p className="text-body text-ink">{rule.description}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-meta text-ink-subtle">{rule.code}</span>
                  <span className="text-data font-semibold tabular-nums text-ink">{rule.points}</span>
                  <span className="text-meta text-ink-muted">documented points</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardBody className="border-t border-line text-meta text-ink-muted">
        Bands: 0–24 low · 25–49 moderate · 50–74 high · 75–100 critical. Totals are capped at 100.
        See docs/decisions.md for the rule decision record.
      </CardBody>
    </Card>
  );
}

function AssessedRecords({
  records,
  ruleSet,
}: {
  records: RiskRecordView[];
  ruleSet: string;
}) {
  const [bandFilter, setBandFilter] = useState<RiskBand | "all">("all");
  const visible =
    bandFilter === "all" ? records : records.filter((record) => record.band === bandFilter);
  const counts = countByBand(records);

  return (
    <Card>
      <CardHeader
        title="Assessed records"
        description="Every record the endpoint returned, in its own order. Scores and bands are rule-set results; expand a record for the indicators behind its score."
        action={
          <span className="text-meta tabular-nums text-ink-muted">
            {records.length} record{records.length === 1 ? "" : "s"}
          </span>
        }
      />
      <CardBody className="space-y-gutter">
        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
          <Field
            label="Filter assessed records by band"
            hint="Filtering changes only which returned rows are listed; it never recalculates a score."
            className="lg:col-span-1"
          >
            {(control) => (
              <Select
                {...control}
                value={bandFilter}
                onChange={(event) => setBandFilter(event.target.value as RiskBand | "all")}
              >
                <option value="all">All bands ({records.length})</option>
                {counts.map((band) => (
                  <option key={band.band} value={band.band}>
                    {band.label} ({band.count})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p
            aria-live="polite"
            className="self-end text-supporting text-ink-secondary lg:col-span-2"
          >
            Showing {visible.length} of {records.length} returned record
            {records.length === 1 ? "" : "s"}.
          </p>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="No returned records in this band"
            message={`The endpoint returned no ${
              bandFilter === "all" ? "assessed" : humanize(bandFilter)
            } records. The filter only changes which returned rows are listed; it does not create an assessment.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setBandFilter("all")}>
                Show all bands
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line">
            {visible.map((record) => (
              <RiskRow key={record.record_id} record={record} ruleSet={ruleSet} />
            ))}
          </ul>
        )}

        <p className="text-meta text-ink-subtle">
          Provenance: scores and bands are results of rule set{" "}
          <span className="font-mono">{ruleSet}</span>; indicator points and explanations are the
          values the endpoint returned. Filtering changes the list only and never recalculates a
          score.
        </p>
      </CardBody>
    </Card>
  );
}

function RiskRow({ record, ruleSet }: { record: RiskRecordView; ruleSet: string }) {
  const tone = toneForRiskBand(record.band);

  return (
    <li className="px-card-x py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">{record.title}</p>
          <p className="mt-0.5 font-mono text-meta text-ink-muted">{record.record_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={toneForSensitivity(record.sensitivity)}>
            {humanize(record.sensitivity)}
          </Badge>
          <span className="text-data font-semibold tabular-nums text-ink">
            {record.score}/{MAX_SCORE}
          </span>
          <Badge tone={tone}>{humanize(record.band)}</Badge>
        </div>
      </div>

      <p className="mt-1 text-meta text-ink-subtle">
        Score and band from rule set <span className="font-mono">{ruleSet}</span>; score capped at{" "}
        {MAX_SCORE}.
      </p>

      {/* The number and the band name above already say what this bar shows. */}
      <div
        aria-hidden="true"
        className="mt-3 h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
      >
        <div
          className={`h-full rounded-pill ${TONE_SOLID[tone]}`}
          style={{ width: `${(Math.min(record.score, MAX_SCORE) / MAX_SCORE) * 100}%` }}
        />
      </div>

      {record.indicators.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-meta font-medium text-accent-ink transition-colors hover:text-accent">
            Show {record.indicators.length} contributing indicator
            {record.indicators.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {record.indicators.map((indicator) => (
              <li key={indicator.code} className="flex flex-wrap gap-x-2 text-meta text-ink-secondary">
                <span className="font-semibold tabular-nums text-ink">+{indicator.points}</span>
                <span className="font-mono text-ink-subtle">{indicator.code}</span>
                <span className="min-w-0 flex-1">{indicator.explanation}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-3 text-meta text-ink-muted">
          No risk indicator applied to this record.
        </p>
      )}
    </li>
  );
}
