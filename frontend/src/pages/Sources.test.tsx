/** Sources page contract tests: the connector API module is mocked. */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanJob, Source, UserProfile } from "../api/types";
import { testUser, withAuth } from "../test/auth";
import Sources from "./Sources";

const listSources = vi.fn();
const createSource = vi.fn();
const validateSource = vi.fn();
const startScan = vi.fn();
const listScanJobs = vi.fn();
const runScanJob = vi.fn();
const retryScanJob = vi.fn();
const listScanResults = vi.fn();
const listScanErrors = vi.fn();

vi.mock("../api/connectors", () => ({
  listSources: (...args: unknown[]) => listSources(...args),
  createSource: (...args: unknown[]) => createSource(...args),
  validateSource: (...args: unknown[]) => validateSource(...args),
  startScan: (...args: unknown[]) => startScan(...args),
  listScanJobs: (...args: unknown[]) => listScanJobs(...args),
  runScanJob: (...args: unknown[]) => runScanJob(...args),
  retryScanJob: (...args: unknown[]) => retryScanJob(...args),
  listScanResults: (...args: unknown[]) => listScanResults(...args),
  listScanErrors: (...args: unknown[]) => listScanErrors(...args),
}));

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 2,
    institution_id: 1,
    name: "Showcase synthetic source",
    connector_type: "synthetic",
    root_key: null,
    config: {},
    status: "active",
    created_by: "ops@example.org",
    last_validated_at: null,
    last_validation_ok: null,
    last_validation_message: null,
    created_at: "2026-11-27T10:00:00",
    updated_at: "2026-11-27T10:00:00",
    ...overrides,
  };
}

function job(status: ScanJob["status"], id = 4): ScanJob {
  return {
    id,
    data_source_id: 2,
    institution_id: 1,
    status,
    batch_size: 6,
    total_discovered: 3,
    total_imported: 3,
    total_skipped: 0,
    total_errors: 0,
    retried_from_job_id: null,
    started_at: "2026-11-27T10:00:00",
    completed_at: "2026-11-27T10:01:00",
    error_message: null,
    created_at: "2026-11-27T10:00:00",
  };
}

/** Scoped institutional admin: platform admins start unscoped by design. */
function scopedAdmin(overrides: Partial<UserProfile> = {}): UserProfile {
  return testUser({ role: "admin", ...overrides });
}

function renderSources(user: UserProfile | null = scopedAdmin()): void {
  render(
    withAuth(
      <MemoryRouter>
        <Sources />
      </MemoryRouter>,
      user,
    ),
  );
}

function page<T>(items: T[], total = items.length) {
  return { items, total, page: 1, per_page: 20, pages: 1 };
}

beforeEach(() => {
  listSources.mockReset().mockResolvedValue(page([source()]));
  listScanJobs.mockReset().mockResolvedValue(page([job("COMPLETED")]));
  createSource.mockReset().mockResolvedValue(source());
  validateSource.mockReset().mockResolvedValue({
    id: 2,
    ok: true,
    message: "Synthetic connector is available.",
    validated_at: "2026-11-27T10:05:00",
  });
  startScan.mockReset().mockResolvedValue(job("PENDING", 5));
  runScanJob.mockReset().mockResolvedValue(job("COMPLETED", 4));
  retryScanJob.mockReset().mockResolvedValue(job("PENDING", 6));
  listScanResults.mockReset().mockResolvedValue(
    page([
      {
        id: 11,
        scan_job_id: 4,
        source_key: "SHOWCASE-001",
        status: "imported",
        title: "Fictional sample",
        record_type: "dataset",
        category: null,
        file_name: null,
        mime_type: null,
        size_bytes: 100,
        sensitivity: "internal",
        contains_personal_data: false,
        imported_asset_id: 42,
        note: null,
        error_message: null,
        created_at: "2026-11-27T10:01:00",
      },
    ]),
  );
  listScanErrors.mockReset().mockResolvedValue(page([]));
});

describe("source and job reads", () => {
  it("requests both lists for the active institution scope and renders their rows", async () => {
    renderSources();

    expect(await screen.findByText("Showcase synthetic source")).toBeInTheDocument();
    expect(screen.getByText("Sources (1)")).toBeInTheDocument();
    expect(screen.getByText("Scan jobs (1)")).toBeInTheDocument();
    expect(listSources).toHaveBeenCalledWith({ institution_id: 1 }, expect.any(AbortSignal));
    expect(listScanJobs).toHaveBeenCalledWith({ institution_id: 1 }, expect.any(AbortSignal));
  });

  it("shows honest empty states when the API returns no rows", async () => {
    listSources.mockResolvedValue(page([]));
    listScanJobs.mockResolvedValue(page([]));

    renderSources();

    expect(await screen.findByRole("heading", { name: /no sources configured/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /no scan jobs recorded/i })).toBeInTheDocument();
  });

  it("shows retryable errors instead of inventing source rows", async () => {
    listSources.mockRejectedValue(new Error("source service unavailable"));
    renderSources();

    expect(await screen.findByRole("alert")).toHaveTextContent("source service unavailable");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not request data without sources:read", () => {
    renderSources(testUser({ permissions: [] }));

    expect(screen.getByText(/source data is not available to this account/i)).toBeInTheDocument();
    expect(listSources).not.toHaveBeenCalled();
    expect(listScanJobs).not.toHaveBeenCalled();
  });
});

describe("source actions", () => {
  it("validates a source and reports the server's message", async () => {
    renderSources();
    await screen.findByText("Showcase synthetic source");

    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    await waitFor(() => expect(validateSource).toHaveBeenCalledWith(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Synthetic connector is available.");
  });

  it("starts a real scan job only after an explicit action", async () => {
    renderSources();
    await screen.findByText("Showcase synthetic source");

    await userEvent.click(screen.getByRole("button", { name: "Scan" }));

    await waitFor(() => expect(startScan).toHaveBeenCalledWith(2, { run: true }));
    expect(await screen.findByRole("status")).toHaveTextContent("Started scan job #5");
  });

  it("creates a synthetic source without sending a path or a secret", async () => {
    renderSources();
    await screen.findByText("Showcase synthetic source");

    await userEvent.type(screen.getByLabelText(/^Source name/), "Another sample source");
    await userEvent.click(screen.getByRole("button", { name: "Create synthetic source" }));

    await waitFor(() => {
      expect(createSource).toHaveBeenCalledWith({
        name: "Another sample source",
        connector_type: "synthetic",
        institution_id: 1,
      });
    });
  });

  it("does not offer write actions to a read-only account", async () => {
    renderSources(testUser());
    await screen.findByText("Showcase synthetic source");

    expect(screen.queryByRole("button", { name: "Validate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create synthetic source" })).toBeNull();
  });
});

describe("scan actions", () => {
  it("runs a pending job through the run route", async () => {
    listScanJobs.mockResolvedValue(page([job("PENDING")]));
    renderSources();
    await screen.findByText("Scan jobs (1)");

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runScanJob).toHaveBeenCalledWith(4));
    expect(screen.getByRole("status")).toHaveTextContent("Ran scan job #4");
  });

  it("retries a failed job through the retry route", async () => {
    listScanJobs.mockResolvedValue(page([job("FAILED")]));
    renderSources();
    await screen.findByText("Scan jobs (1)");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(retryScanJob).toHaveBeenCalledWith(4));
    expect(screen.getByRole("status")).toHaveTextContent("Created retry job #6");
  });

  it("inspects stored results and errors from the job's own routes", async () => {
    renderSources();
    await screen.findByText("Scan jobs (1)");

    await userEvent.click(screen.getByRole("button", { name: /inspect/i }));

    expect(await screen.findByText("Fictional sample")).toBeInTheDocument();
    expect(listScanResults).toHaveBeenCalledWith(4, 1, expect.any(AbortSignal));
    expect(listScanErrors).toHaveBeenCalledWith(4, 1, expect.any(AbortSignal));
    expect(screen.getByText(/no row-level errors were recorded/i)).toBeInTheDocument();
  });
});

describe("honesty boundaries", () => {
  it("names the synthetic connector and disclaims institutional integrations", async () => {
    renderSources();
    await screen.findByText("Showcase synthetic source");

    expect(screen.getByText(/no institutional system, absolute path or secret is connected/i)).toBeInTheDocument();
    expect(screen.getByText(/no institutional system is contacted/i)).toBeInTheDocument();
  });

  it("offers no deletion, archive or disposal control", async () => {
    renderSources();
    await screen.findByText("Scan jobs (1)");

    expect(
      screen.queryByRole("button", { name: /delete|dispose|purge|archive/i }),
    ).toBeNull();
  });
});
