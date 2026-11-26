/**
 * Sources and scan jobs.
 *
 * The only connector offered here is the server's synthetic connector: it reads
 * generated metadata, never a real institutional system, absolute path or
 * secret. Every row, counter and result shown is returned by the real source /
 * scan-job API. Actions call the documented routes and report only what the
 * server actually answers.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  createSource,
  listScanErrors,
  listScanJobs,
  listScanResults,
  listSources,
  retryScanJob,
  runScanJob,
  startScan,
  validateSource,
} from "../api/connectors";
import { toErrorMessage } from "../api/client";
import type { ScanJob, ScanStatusValue, Source } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { FOCUS_RING } from "../components/ui/control";
import { Spinner } from "../components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { IconChevronRight, IconEye, IconRefresh, IconShield } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";
import { formatDate, humanize } from "../lib/format";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

type Tone = "neutral" | "info" | "success" | "warning" | "caution" | "critical";

function toneForJob(status: ScanStatusValue): Tone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "COMPLETED_WITH_ERRORS":
      return "caution";
    case "FAILED":
    case "CANCELLED":
      return "critical";
    case "RUNNING":
      return "info";
    default:
      return "neutral";
  }
}

function Notice({ tone, text }: { tone: "success" | "critical"; text: string }) {
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={`rounded-card border px-card-x py-card-y text-supporting ${
        tone === "critical"
          ? "border-critical-line bg-critical-surface text-critical-ink"
          : "border-success-line bg-success-surface text-success-ink"
      }`}
    >
      {text}
    </div>
  );
}

function timestamp(iso: string | null): string {
  return iso ? formatDate(iso.slice(0, 10)) : "—";
}

function JobDetails({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const results = useApiQuery((signal) => listScanResults(jobId, 1, signal), [jobId]);
  const errors = useApiQuery((signal) => listScanErrors(jobId, 1, signal), [jobId]);

  return (
    <Card>
      <CardHeader
        title={`Scan job #${jobId} evidence`}
        description="Metadata rows and row-level errors the server stored for this job."
        action={
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close evidence
          </Button>
        }
      />
      <CardBody className="space-y-gutter">
        {results.error ? (
          <ErrorState title="Results unavailable" message={results.error} onRetry={results.refetch} />
        ) : null}
        {results.loading && results.data === null ? (
          <Spinner label="Loading scan results…" />
        ) : null}
        {results.data?.items.length === 0 ? (
          <p className="text-supporting text-ink-muted">No metadata rows were recorded for this job.</p>
        ) : null}
        {results.data && results.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <Table caption="Discovered metadata rows">
              <TableHead>
                <TableRow>
                  <TableHeaderCell scope="col">Title</TableHeaderCell>
                  <TableHeaderCell scope="col">Status</TableHeaderCell>
                  <TableHeaderCell scope="col">Source key</TableHeaderCell>
                  <TableHeaderCell scope="col">Imported asset</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-ink">{row.title}</TableCell>
                    <TableCell>{humanize(row.status)}</TableCell>
                    <TableCell className="font-mono text-meta text-ink-muted">
                      {row.source_key}
                    </TableCell>
                    <TableCell>
                      {row.imported_asset_id === null ? (
                        <span className="text-meta text-ink-muted">Not imported</span>
                      ) : (
                        <Link to={`/inventory/${row.imported_asset_id}/edit`} className={LINK_CLASS}>
                          #{row.imported_asset_id}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {errors.error ? (
          <ErrorState title="Errors unavailable" message={errors.error} onRetry={errors.refetch} />
        ) : null}
        {errors.loading && errors.data === null ? <Spinner label="Loading scan errors…" /> : null}
        {errors.data?.items.length === 0 ? (
          <p className="text-supporting text-ink-muted">No row-level errors were recorded.</p>
        ) : null}
        {errors.data && errors.data.items.length > 0 ? (
          <Table caption="Recorded scan errors">
            <TableHead>
              <TableRow>
                <TableHeaderCell scope="col">Severity</TableHeaderCell>
                <TableHeaderCell scope="col">Source key</TableHeaderCell>
                <TableHeaderCell scope="col">Message</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {errors.data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{humanize(row.severity)}</TableCell>
                  <TableCell className="font-mono text-meta text-ink-muted">
                    {row.source_key ?? "—"}
                  </TableCell>
                  <TableCell className="text-ink-secondary">{row.error_message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardBody>
    </Card>
  );
}

function CreateSourceForm({
  institutionId,
  onCreated,
}: {
  institutionId: number | null;
  onCreated: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const source = await createSource({
        name: name.trim(),
        connector_type: "synthetic",
        ...(institutionId === null ? {} : { institution_id: institutionId }),
      });
      setName("");
      onCreated(`Created synthetic source #${source.id} “${source.name}”.`);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field
        label="Source name"
        required
        hint="A fictional name; the synthetic connector needs no path, credential or secret."
      >
        {(control) => (
          <Input
            {...control}
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Showcase sample source"
          />
        )}
      </Field>
      {error ? <Notice tone="critical" text={error} /> : null}
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create synthetic source"}
      </Button>
    </form>
  );
}

function SourceData({
  institutionId,
  canWrite,
}: {
  institutionId: number | null;
  canWrite: boolean;
}) {
  const scope = institutionId ?? undefined;
  const sources = useApiQuery((signal) => listSources({ institution_id: scope }, signal), [scope]);
  const jobs = useApiQuery((signal) => listScanJobs({ institution_id: scope }, signal), [scope]);
  const [notice, setNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);

  async function act(key: string, action: () => Promise<void>): Promise<void> {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setNotice({ tone: "critical", text: toErrorMessage(cause) });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-gutter">
      {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}

      {sources.error ? (
        <ErrorState
          title="Sources unavailable"
          message={sources.error}
          onRetry={sources.refetch}
        />
      ) : null}
      {jobs.error ? (
        <ErrorState title="Scan jobs unavailable" message={jobs.error} onRetry={jobs.refetch} />
      ) : null}

      {sources.loading && sources.data === null ? (
        <Card>
          <CardHeader title="Loading sources" description="Reading configured sources from the API." />
          <CardBody>
            <Spinner label="Loading sources…" />
          </CardBody>
        </Card>
      ) : null}
      {jobs.loading && jobs.data === null ? (
        <Card>
          <CardHeader title="Loading scan jobs" description="Reading the recorded scan history." />
          <CardBody>
            <Spinner label="Loading scan jobs…" />
          </CardBody>
        </Card>
      ) : null}

      {sources.data ? (
        <Card>
          <CardHeader
            title={`Sources (${sources.data.total})`}
            description={
              institutionId === null
                ? "Every source this account can read. Only the synthetic connector is available here."
                : `Scoped to institution #${institutionId}. Only the synthetic connector is available here.`
            }
            action={
              <Button
                variant="secondary"
                onClick={sources.refetch}
                disabled={sources.loading}
                className="gap-1.5"
              >
                <IconRefresh className="h-4 w-4" />
                Refresh sources
              </Button>
            }
          />
          {sources.data.items.length === 0 ? (
            <CardBody>
              <EmptyState
                title="No sources configured"
                message="No synthetic source has been configured for this scope. Nothing is discovered automatically."
              />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Configured sources">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">Source</TableHeaderCell>
                    <TableHeaderCell scope="col">Connector</TableHeaderCell>
                    <TableHeaderCell scope="col">State</TableHeaderCell>
                    <TableHeaderCell scope="col">Validation</TableHeaderCell>
                    <TableHeaderCell scope="col">Created by</TableHeaderCell>
                    <TableHeaderCell scope="col" align="right">
                      Action
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sources.data.items.map((source: Source) => (
                    <TableRow key={source.id}>
                      <TableCell>
                        <p className="font-medium text-ink">{source.name}</p>
                        <p className="mt-0.5 text-meta text-ink-muted">#{source.id}</p>
                      </TableCell>
                      <TableCell>{humanize(source.connector_type ?? "unknown")}</TableCell>
                      <TableCell>
                        <Badge tone={source.status === "active" ? "success" : "neutral"}>
                          {humanize(source.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {source.last_validation_ok === null
                          ? "Not validated"
                          : source.last_validation_ok
                            ? "Passed"
                            : "Failed"}
                        {source.last_validation_message ? (
                          <p className="mt-0.5 max-w-xs text-meta text-ink-muted">
                            {source.last_validation_message}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="break-all text-meta text-ink-secondary">
                        {source.created_by}
                      </TableCell>
                      <TableCell align="right">
                        {canWrite ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busyKey !== null}
                              onClick={() =>
                                void act(`validate-${source.id}`, async () => {
                                  const result = await validateSource(source.id);
                                  setNotice({
                                    tone: result.ok ? "success" : "critical",
                                    text: result.message,
                                  });
                                  sources.refetch();
                                })
                              }
                            >
                              Validate
                            </Button>
                            <Button
                              size="sm"
                              disabled={busyKey !== null}
                              onClick={() =>
                                void act(`scan-${source.id}`, async () => {
                                  const job = await startScan(source.id, { run: true });
                                  setNotice({
                                    tone: "success",
                                    text: `Started scan job #${job.id} through the server connector.`,
                                  });
                                  jobs.refetch();
                                })
                              }
                            >
                              Scan
                            </Button>
                          </div>
                        ) : (
                          <span className="text-meta text-ink-subtle">Read only</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      ) : null}

      {jobs.data ? (
        <Card>
          <CardHeader
            title={`Scan jobs (${jobs.data.total})`}
            description="Run outcomes recorded by the API; counters are the server's own totals."
            action={
              <Button
                variant="secondary"
                onClick={jobs.refetch}
                disabled={jobs.loading}
                className="gap-1.5"
              >
                <IconRefresh className="h-4 w-4" />
                Refresh jobs
              </Button>
            }
          />
          {jobs.data.items.length === 0 ? (
            <CardBody>
              <EmptyState
                title="No scan jobs recorded"
                message="Validate a source, then start a scan to create a job row. No job is created without an explicit action."
              />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Recorded scan jobs">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">Job</TableHeaderCell>
                    <TableHeaderCell scope="col">Status</TableHeaderCell>
                    <TableHeaderCell scope="col">Discovered / imported / errors</TableHeaderCell>
                    <TableHeaderCell scope="col">Created</TableHeaderCell>
                    <TableHeaderCell scope="col" align="right">
                      Action
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.data.items.map((job: ScanJob) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <p className="font-medium text-ink">#{job.id}</p>
                        <p className="mt-0.5 text-meta text-ink-muted">
                          Source #{job.data_source_id}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge tone={toneForJob(job.status)}>{humanize(job.status)}</Badge>
                        {job.error_message ? (
                          <p className="mt-0.5 max-w-xs text-meta text-ink-muted">
                            {job.error_message}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums text-ink-secondary">
                        {job.total_discovered} / {job.total_imported} / {job.total_errors}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-secondary">
                        {timestamp(job.created_at)}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setInspected((current) => (current === job.id ? null : job.id))
                            }
                          >
                            <IconEye className="h-4 w-4" />
                            {inspected === job.id ? "Hide evidence" : "Inspect"}
                          </Button>
                          {canWrite && job.status === "PENDING" ? (
                            <Button
                              size="sm"
                              disabled={busyKey !== null}
                              onClick={() =>
                                void act(`run-${job.id}`, async () => {
                                  const updated = await runScanJob(job.id);
                                  setNotice({
                                    tone: "success",
                                    text: `Ran scan job #${updated.id}: ${humanize(updated.status)}.`,
                                  });
                                  jobs.refetch();
                                })
                              }
                            >
                              Run
                            </Button>
                          ) : null}
                          {canWrite && (job.status === "FAILED" || job.status === "CANCELLED") ? (
                            <Button
                              size="sm"
                              disabled={busyKey !== null}
                              onClick={() =>
                                void act(`retry-${job.id}`, async () => {
                                  const created = await retryScanJob(job.id);
                                  setNotice({
                                    tone: "success",
                                    text: `Created retry job #${created.id}. The original row is unchanged.`,
                                  });
                                  jobs.refetch();
                                })
                              }
                            >
                              Retry
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      ) : null}

      {inspected !== null ? (
        <JobDetails jobId={inspected} onClose={() => setInspected(null)} />
      ) : null}

      {canWrite ? (
        <Card>
          <CardHeader
            title="Add a synthetic source"
            description="A server-side connector that generates fictional metadata. No institutional system is contacted."
            action={<Badge tone="info">Synthetic only</Badge>}
          />
          <CardBody>
            <CreateSourceForm
              institutionId={institutionId}
              onCreated={(message) => {
                setNotice({ tone: "success", text: message });
                sources.refetch();
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/** Authorization and session checks happen before any data request is made. */
export default function Sources() {
  const { status, has, activeInstitutionId } = useAuth();
  const canRead = has("sources:read");
  const canWrite = has("sources:write");

  return (
    <div className="space-y-gutter">
      <PageHeader
        title="Sources & Scan Jobs"
        description="Real connectors and stored scan outcomes. This prototype exposes only the synthetic connector; no institutional system, absolute path or secret is connected."
        actions={<Badge tone={canWrite ? "info" : "neutral"}>{canWrite ? "Write access" : "Read only"}</Badge>}
      />

      {status === "loading" ? (
        <Card>
          <CardHeader title="Checking access" description="Verifying the permissions for this session." />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      ) : null}

      {status === "anonymous" ? (
        <Card>
          <CardHeader title="Source data needs a session" description="No source request was made." />
          <CardBody>
            <EmptyState
              title="Sign in to view sources"
              message="The source and scan-job endpoints require a verified DataDiet session."
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
            title="Source data is not available to this account"
            description="The server-verified permissions for this session do not include sources:read."
          />
          <CardBody className="flex items-start gap-3">
            <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
            <p className="text-supporting text-ink-secondary">
              The API would refuse a request, so none is attempted. This is shown as information, not
              as a retryable data error.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && canRead ? (
        <SourceData institutionId={activeInstitutionId} canWrite={canWrite} />
      ) : null}

      <Card>
        <CardHeader
          title="Not connected here"
          description="Capabilities deliberately absent from this prototype."
        />
        <CardBody className="space-y-2 text-supporting text-ink-secondary">
          <p>
            <strong className="font-semibold text-ink">Institutional connectors:</strong> no cloud
            drive, HR system or document store integration is implemented. The synthetic connector
            generates fictional metadata only.
          </p>
          <p>
            <strong className="font-semibold text-ink">Record contents and file operations:</strong>{" "}
            scans read metadata; they do not open, move, archive or delete files.
          </p>
          <p>
            <strong className="font-semibold text-ink">Automatic deletion:</strong> no scan,
            retry or validation action disposes of data.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
