/**
 * Typed client for the dashboard summary (`GET /api/v1/dashboard/summary`).
 *
 * Every figure is aggregated by the backend from the same scoped tables the
 * inventory and review screens read. The browser supplies only the active
 * institution scope; it never computes a figure locally.
 */

import { apiGet } from "./client";
import type { DashboardSummary } from "./types";

export const DASHBOARD_PREFIX = "/api/v1/dashboard";

export function getDashboardSummary(
  institutionId: number | null,
  signal?: AbortSignal,
): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (institutionId !== null) {
    params.set("institution_id", String(institutionId));
  }
  const query = params.toString();
  return apiGet<DashboardSummary>(
    `${DASHBOARD_PREFIX}/summary${query ? `?${query}` : ""}`,
    signal,
  );
}
