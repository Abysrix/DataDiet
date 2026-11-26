/**
 * Transport tests for the connector API. The URLs and query aliases here mirror
 * `backend/app/api/routes/connectors.py`: `status` is the wire name for both
 * source and job status filters, and no path or secret is ever sent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
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
} from "./connectors";
import type { PaginatedSources, ScanJob } from "./types";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  } as Response;
}

const sources: PaginatedSources = { items: [], total: 0, page: 1, per_page: 20, pages: 0 };
const job: ScanJob = {
  id: 4,
  data_source_id: 2,
  institution_id: 1,
  status: "PENDING",
  batch_size: 6,
  total_discovered: 0,
  total_imported: 0,
  total_skipped: 0,
  total_errors: 0,
  retried_from_job_id: null,
  started_at: null,
  completed_at: null,
  error_message: null,
  created_at: "2026-11-27T10:00:00",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source transport", () => {
  it("sends the server's query names and institution scope", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(sources));

    await listSources({ page: 2, per_page: 10, status: "active", institution_id: 1 });

    expect(spy.mock.calls[0][0]).toBe(
      "/api/v1/sources?page=2&per_page=10&status=active&institution_id=1",
    );
  });

  it("creates only a synthetic source with no path or secret", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 2 }));
    const input = { name: "Showcase synthetic source", connector_type: "synthetic" as const };

    await createSource(input);

    expect(spy.mock.calls[0][0]).toBe("/api/v1/sources");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toEqual(input);
  });

  it("validates a source through the server route", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await validateSource(2);

    expect(spy.mock.calls[0][0]).toBe("/api/v1/sources/2/validate");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });
});

describe("scan transport", () => {
  it("starts a scan for one source with the documented body shape", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(job));

    await startScan(2, { batch_size: 10, run: true });

    expect(spy.mock.calls[0][0]).toBe("/api/v1/sources/2/scans");
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toEqual({
      batch_size: 10,
      run: true,
    });
  });

  it("lists jobs with the status alias and source filter", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, per_page: 20, pages: 0 }));

    await listScanJobs({ page: 1, data_source_id: 2, status: "COMPLETED" });

    expect(spy.mock.calls[0][0]).toBe(
      "/api/v1/scan-jobs?page=1&data_source_id=2&status=COMPLETED",
    );
  });

  it("runs and retries through their distinct routes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(job));

    await runScanJob(4);
    await retryScanJob(4);

    expect(spy.mock.calls[0][0]).toBe("/api/v1/scan-jobs/4/run");
    expect(spy.mock.calls[1][0]).toBe("/api/v1/scan-jobs/4/retry");
  });

  it("reads results and errors from the job's own routes", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, per_page: 50, pages: 0 }));

    await listScanResults(4, 2);
    await listScanErrors(4);

    expect(spy.mock.calls[0][0]).toBe("/api/v1/scan-jobs/4/results?page=2&per_page=50");
    expect(spy.mock.calls[1][0]).toBe("/api/v1/scan-jobs/4/errors?page=1&per_page=50");
  });

  it("threads the abort signal into read requests", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, per_page: 20, pages: 0 }));
    const controller = new AbortController();

    await listSources({}, controller.signal);

    expect((spy.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });
});
