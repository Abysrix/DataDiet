/**
 * Typed client for the real source and scan-job API (`/api/v1/sources`,
 * `/api/v1/scan-jobs`).
 *
 * Reads need `sources:read`; writes need `sources:write`. This module never
 * sends a filesystem path, secret, or institutional connector credential: the
 * only connector exposed to this UI is the server's synthetic connector.
 */

import { apiGet, apiPost } from "./client";
import type {
  PaginatedScanErrors,
  PaginatedScanJobs,
  PaginatedScanResults,
  PaginatedSources,
  ScanJob,
  ScanJobQuery,
  ScanRequestInput,
  Source,
  SourceCreate,
  SourceQuery,
  SourceValidationResult,
} from "./types";

export const SOURCES_PREFIX = "/api/v1/sources";
export const SCAN_JOBS_PREFIX = "/api/v1/scan-jobs";

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function withQuery(prefix: string, query: string): string {
  return query ? `${prefix}?${query}` : prefix;
}

/** One page of configured sources, scoped by the server to this identity. */
export function listSources(query: SourceQuery = {}, signal?: AbortSignal): Promise<PaginatedSources> {
  return apiGet<PaginatedSources>(
    withQuery(
      SOURCES_PREFIX,
      queryString({
        page: query.page,
        per_page: query.per_page,
        status: query.status,
        institution_id: query.institution_id,
      }),
    ),
    signal,
  );
}

/** Creates a source. The UI only offers the synthetic connector. */
export function createSource(input: SourceCreate): Promise<Source> {
  return apiPost<Source>(SOURCES_PREFIX, input);
}

/** Validates a source through the server connector; no local file access. */
export function validateSource(sourceId: number): Promise<SourceValidationResult> {
  return apiPost<SourceValidationResult>(`${SOURCES_PREFIX}/${sourceId}/validate`);
}

/** Starts a real scan job for an existing source. */
export function startScan(sourceId: number, input: ScanRequestInput = {}): Promise<ScanJob> {
  return apiPost<ScanJob>(`${SOURCES_PREFIX}/${sourceId}/scans`, input);
}

/** One page of jobs, including their own server-recorded counters. */
export function listScanJobs(
  query: ScanJobQuery = {},
  signal?: AbortSignal,
): Promise<PaginatedScanJobs> {
  return apiGet<PaginatedScanJobs>(
    withQuery(
      SCAN_JOBS_PREFIX,
      queryString({
        page: query.page,
        per_page: query.per_page,
        data_source_id: query.data_source_id,
        status: query.status,
        institution_id: query.institution_id,
      }),
    ),
    signal,
  );
}

/** Runs a pending job; refused by the server if it is not in a valid state. */
export function runScanJob(jobId: number): Promise<ScanJob> {
  return apiPost<ScanJob>(`${SCAN_JOBS_PREFIX}/${jobId}/run`);
}

/** Retries a failed job by creating a new job row; the old row is unchanged. */
export function retryScanJob(jobId: number): Promise<ScanJob> {
  return apiPost<ScanJob>(`${SCAN_JOBS_PREFIX}/${jobId}/retry`);
}

/** Metadata discovered by one job, with its stored import outcome. */
export function listScanResults(
  jobId: number,
  page = 1,
  signal?: AbortSignal,
): Promise<PaginatedScanResults> {
  return apiGet<PaginatedScanResults>(
    withQuery(
      `${SCAN_JOBS_PREFIX}/${jobId}/results`,
      queryString({ page, per_page: 50 }),
    ),
    signal,
  );
}

/** Row-level errors the server recorded while that job ran. */
export function listScanErrors(
  jobId: number,
  page = 1,
  signal?: AbortSignal,
): Promise<PaginatedScanErrors> {
  return apiGet<PaginatedScanErrors>(
    withQuery(`${SCAN_JOBS_PREFIX}/${jobId}/errors`, queryString({ page, per_page: 50 })),
    signal,
  );
}
