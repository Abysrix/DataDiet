/** Public service health probe, independent of any demo or data endpoint. */

import { apiGet } from "./client";
import type { HealthResponse } from "./types";

const API_PREFIX = "/api/v1";

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiGet<HealthResponse>(`${API_PREFIX}/health`, signal);
}
