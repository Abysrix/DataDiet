/**
 * Typed clients for stored risk assessments and their documented rules.
 *
 * The API returns scores and explanations produced by `app.services.risk`.
 * Nothing in this module calculates a score or accepts a client-supplied one.
 */

import { apiGet } from "./client";
import type { RiskAssessmentList, RiskAssessmentQuery, RiskRules } from "./types";

export const RISK_PREFIX = "/api/v1/risk";

export function listRiskAssessments(
  query: RiskAssessmentQuery = {},
  signal?: AbortSignal,
): Promise<RiskAssessmentList> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.per_page !== undefined) params.set("per_page", String(query.per_page));
  if (query.band) params.set("band", query.band);
  if (query.search) params.set("search", query.search);
  if (query.institution_id !== undefined) {
    params.set("institution_id", String(query.institution_id));
  }
  const suffix = params.toString();
  return apiGet<RiskAssessmentList>(
    `${RISK_PREFIX}/assessments${suffix ? `?${suffix}` : ""}`,
    signal,
  );
}

export function getRiskRules(signal?: AbortSignal): Promise<RiskRules> {
  return apiGet<RiskRules>(`${RISK_PREFIX}/rules`, signal);
}
