/**
 * Asset create/edit screens.
 *
 * Both forms call the real `/api/v1/assets` routes: `POST` for a new record and
 * `PATCH` for an existing one. Nothing is shown as saved until the server
 * returns the written asset. The form only edits metadata — there is no archive,
 * restore, deletion or disposal control anywhere here.
 */

import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { createAsset, getAsset, updateAsset } from "../api/assets";
import { toErrorMessage } from "../api/client";
import type {
  Asset,
  AssetCreateInput,
  AssetSensitivity,
  AssetUpdateInput,
  LifecycleStatus,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import { Textarea } from "../components/ui/Textarea";
import { FOCUS_RING } from "../components/ui/control";
import { IconChevronRight, IconShield } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;
const BUTTON_LINK_CLASS = `inline-flex min-h-9 items-center gap-1.5 rounded-control bg-surface px-control-x py-control-y text-body font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-hover ${FOCUS_RING}`;

const SENSITIVITY_OPTIONS: AssetSensitivity[] = [
  "unknown",
  "public",
  "internal",
  "confidential",
  "restricted",
];
const LIFECYCLE_OPTIONS: LifecycleStatus[] = [
  "active",
  "under_review",
  "archived",
  "pending_disposal",
];

interface FormValues {
  externalId: string;
  dataSourceId: string;
  title: string;
  description: string;
  recordType: string;
  category: string;
  sourceType: string;
  sizeBytes: string;
  sensitivity: AssetSensitivity;
  containsPersonalData: boolean;
  ownerTeam: string;
  ownerEmail: string;
  lifecycleStatus: LifecycleStatus;
  lastReviewed: string;
  fileName: string;
  mimeType: string;
}

const CREATE_VALUES: FormValues = {
  externalId: "",
  dataSourceId: "",
  title: "",
  description: "",
  recordType: "dataset",
  category: "",
  sourceType: "",
  sizeBytes: "0",
  sensitivity: "unknown",
  containsPersonalData: false,
  ownerTeam: "",
  ownerEmail: "",
  lifecycleStatus: "active",
  lastReviewed: "",
  fileName: "",
  mimeType: "",
};

function fromAsset(asset: Asset): FormValues {
  return {
    externalId: asset.external_id,
    dataSourceId: String(asset.data_source_id),
    title: asset.title,
    description: asset.description ?? "",
    recordType: asset.record_type,
    category: asset.category ?? "",
    sourceType: asset.source_type ?? "",
    sizeBytes: String(asset.size_bytes),
    sensitivity: asset.sensitivity,
    containsPersonalData: asset.contains_personal_data,
    ownerTeam: asset.owner_team ?? "",
    ownerEmail: asset.owner_email ?? "",
    lifecycleStatus: asset.lifecycle_status,
    lastReviewed: asset.last_reviewed ?? "",
    fileName: asset.file_name ?? "",
    mimeType: asset.mime_type ?? "",
  };
}

/** Blank strings become `null`, so clearing an optional field clears the row. */
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

function AssetForm({
  editing,
  asset,
  institutionId,
}: {
  editing: boolean;
  asset?: Asset;
  institutionId: number | null;
}) {
  const [values, setValues] = useState<FormValues>(asset ? fromAsset(asset) : CREATE_VALUES);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(
    null,
  );

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setNotice(null);

    const sizeBytes = Number(values.sizeBytes || "0");
    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
      setNotice({ tone: "critical", text: "Size in bytes must be a whole number of zero or more." });
      return;
    }

    const sourceId = Number(values.dataSourceId);
    if (!editing && (!Number.isInteger(sourceId) || sourceId < 1)) {
      setNotice({
        tone: "critical",
        text: "A data source is required: enter the numeric id of a source you may read.",
      });
      return;
    }

    setBusy(true);
    try {
      if (editing && asset) {
        const input: AssetUpdateInput = {
          title: values.title.trim(),
          description: optional(values.description),
          category: optional(values.category),
          sensitivity: values.sensitivity,
          contains_personal_data: values.containsPersonalData,
          owner_team: optional(values.ownerTeam),
          owner_email: optional(values.ownerEmail),
          lifecycle_status: values.lifecycleStatus,
          last_reviewed: optional(values.lastReviewed),
          size_bytes: sizeBytes,
          file_name: optional(values.fileName),
          mime_type: optional(values.mimeType),
        };
        const saved = await updateAsset(asset.id, input);
        setNotice({
          tone: "success",
          text: `Saved asset #${saved.id} “${saved.title}”. The row returned by the API is now current.`,
        });
      } else {
        const input: AssetCreateInput = {
          data_source_id: sourceId,
          external_id: values.externalId.trim(),
          title: values.title.trim(),
          description: optional(values.description),
          record_type: values.recordType.trim(),
          category: optional(values.category),
          source_type: optional(values.sourceType),
          size_bytes: sizeBytes,
          sensitivity: values.sensitivity,
          contains_personal_data: values.containsPersonalData,
          owner_team: optional(values.ownerTeam),
          owner_email: optional(values.ownerEmail),
          lifecycle_status: values.lifecycleStatus,
          last_reviewed: optional(values.lastReviewed),
          file_name: optional(values.fileName),
          mime_type: optional(values.mimeType),
          ...(institutionId === null ? {} : { institution_id: institutionId }),
        };
        const saved = await createAsset(input);
        setNotice({
          tone: "success",
          text: `Created asset #${saved.id} “${saved.title}” in the server-verified institution scope.`,
        });
      }
    } catch (cause) {
      setNotice({ tone: "critical", text: toErrorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-gutter">
      {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}

      <Card>
        <CardHeader
          title={editing ? "Stored identity" : "Source and identifier"}
          description={
            editing
              ? "The external id and source are immutable after creation; they are shown for reference."
              : "Choose the source this fictional record belongs to and its stable identifier."
          }
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {editing && asset ? (
            <>
              <Field label="External id">
                {(control) => <Input {...control} value={asset.external_id} disabled />}
              </Field>
              <Field label="Data source id">
                {(control) => <Input {...control} value={asset.data_source_id} disabled />}
              </Field>
            </>
          ) : (
            <>
              <Field label="External id" required hint="A stable identifier; fictional samples use SHOWCASE-…">
                {(control) => (
                  <Input
                    {...control}
                    required
                    value={values.externalId}
                    onChange={(event) => set("externalId", event.target.value)}
                    placeholder="SHOWCASE-ASSET-050"
                  />
                )}
              </Field>
              <Field label="Data source id" required hint="Numeric id of a real source in this scope">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    required
                    value={values.dataSourceId}
                    onChange={(event) => set("dataSourceId", event.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Metadata"
          description="Only metadata is edited. No lifecycle action, archive or disposal is performed by this form."
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2">
            {(control) => (
              <Input
                {...control}
                required
                maxLength={300}
                value={values.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder="Fictional sample: enrolment extract"
              />
            )}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {(control) => (
              <Textarea
                {...control}
                value={values.description}
                onChange={(event) => set("description", event.target.value)}
              />
            )}
          </Field>
          <Field label="Record type" required>
            {(control) => (
              <Input
                {...control}
                required
                value={values.recordType}
                onChange={(event) => set("recordType", event.target.value)}
                placeholder="dataset"
              />
            )}
          </Field>
          <Field label="Category">
            {(control) => (
              <Input
                {...control}
                value={values.category}
                onChange={(event) => set("category", event.target.value)}
                placeholder="finance"
              />
            )}
          </Field>
          <Field label="Source type">
            {(control) => (
              <Input
                {...control}
                value={values.sourceType}
                onChange={(event) => set("sourceType", event.target.value)}
                placeholder="showcase_sample"
              />
            )}
          </Field>
          <Field label="Sensitivity">
            {(control) => (
              <Select
                {...control}
                value={values.sensitivity}
                onChange={(event) => set("sensitivity", event.target.value as AssetSensitivity)}
              >
                {SENSITIVITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "unknown" ? "Not classified" : option}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Lifecycle status">
            {(control) => (
              <Select
                {...control}
                value={values.lifecycleStatus}
                onChange={(event) =>
                  set("lifecycleStatus", event.target.value as LifecycleStatus)
                }
              >
                {LIFECYCLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Last reviewed">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={values.lastReviewed}
                onChange={(event) => set("lastReviewed", event.target.value)}
              />
            )}
          </Field>
          <Field label="Size in bytes">
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                step={1}
                value={values.sizeBytes}
                onChange={(event) => set("sizeBytes", event.target.value)}
              />
            )}
          </Field>
          <Field label="File name">
            {(control) => (
              <Input
                {...control}
                value={values.fileName}
                onChange={(event) => set("fileName", event.target.value)}
              />
            )}
          </Field>
          <Field label="MIME type">
            {(control) => (
              <Input
                {...control}
                value={values.mimeType}
                onChange={(event) => set("mimeType", event.target.value)}
                placeholder="application/json"
              />
            )}
          </Field>
          <Field label="Owner team">
            {(control) => (
              <Input
                {...control}
                value={values.ownerTeam}
                onChange={(event) => set("ownerTeam", event.target.value)}
              />
            )}
          </Field>
          <Field label="Owner email">
            {(control) => (
              <Input
                {...control}
                type="email"
                value={values.ownerEmail}
                onChange={(event) => set("ownerEmail", event.target.value)}
              />
            )}
          </Field>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={values.containsPersonalData}
              onChange={(event) => set("containsPersonalData", event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-control border-line-strong accent-accent"
            />
            <span className="text-supporting text-ink-secondary">
              Contains personal data
              <span className="mt-0.5 block text-meta text-ink-muted">
                Fictional sample rows only; never enter a real person&apos;s data here.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !values.title.trim() || !values.recordType.trim()}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create asset"}
        </Button>
        <Link to="/inventory" className={BUTTON_LINK_CLASS}>
          Back to inventory
          <IconChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </form>
  );
}

function EditLoader({ assetId, institutionId }: { assetId: number; institutionId: number | null }) {
  const { data, loading, error, refetch } = useApiQuery(
    (signal) => getAsset(assetId, signal),
    [assetId],
  );

  if (error) {
    return <ErrorState title="Asset unavailable" message={error} onRetry={refetch} />;
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader
          title="Loading asset"
          description="Reading this record from the inventory API before showing its edit form."
        />
        <CardBody>
          <Spinner label="Loading asset…" />
        </CardBody>
      </Card>
    );
  }
  return <AssetForm editing asset={data} institutionId={institutionId} />;
}

/** Permission and session gates run before any asset request is attempted. */
export default function AssetEditor() {
  const { assetId } = useParams<{ assetId: string }>();
  const { status, has, activeInstitutionId } = useAuth();
  const canWrite = has("assets:write");
  const editing = assetId !== undefined;
  const numericId = editing ? Number(assetId) : null;
  const validId = editing && numericId !== null && Number.isInteger(numericId) && numericId > 0;

  const heading = editing ? "Edit asset" : "Create asset";
  const description = editing
    ? "Change only the metadata the asset API allows. The saved values come back from the server."
    : "Add a fictional sample record through the asset API. Nothing is written until the server confirms it.";

  return (
    <div className="space-y-gutter">
      <PageHeader
        title={heading}
        description={description}
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
          <CardHeader title="A verified session is required" description="No asset request was made." />
          <CardBody>
            <EmptyState
              title="Sign in to edit inventory"
              message="The asset write routes require a verified DataDiet session."
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

      {status === "authenticated" && !canWrite ? (
        <Card>
          <CardHeader
            title="Asset writes are not available to this account"
            description="The server-verified permissions for this session do not include assets:write."
          />
          <CardBody className="flex items-start gap-3">
            <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
            <p className="text-supporting text-ink-secondary">
              The API would refuse a write, so none is attempted. This is shown as information, not
              as a retryable data error.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && canWrite && editing && !validId ? (
        <Card>
          <CardHeader title="Invalid asset id" description="The URL did not name a usable asset." />
          <CardBody>
            <EmptyState
              title="No asset was loaded"
              message="Open an asset from Data Inventory to edit a specific record."
              action={
                <Link to="/inventory" className={LINK_CLASS}>
                  Back to inventory
                  <IconChevronRight className="h-4 w-4" />
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {status === "authenticated" && canWrite && !editing ? (
        <AssetForm editing={false} institutionId={activeInstitutionId} />
      ) : null}

      {status === "authenticated" && canWrite && validId ? (
        <EditLoader assetId={numericId} institutionId={activeInstitutionId} />
      ) : null}
    </div>
  );
}
