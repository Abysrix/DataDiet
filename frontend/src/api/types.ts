/**
 * Shared API types.
 *
 * These mirror the backend Pydantic schemas (backend/app/api/schemas). Keep them
 * in sync manually for now; code generation is a Phase 2 candidate.
 */

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export type RiskBand = "low" | "moderate" | "high" | "critical";
export type RetentionAction = "retain" | "archive" | "review" | "eligible_for_disposal";
export type PolicyStatus = "active" | "draft" | "retired";

export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
}

/* ------------------------------------------------------------------------
 * Inventory: the real asset table (GET /api/v1/assets).
 * Mirrors backend/app/api/schemas/assets.py — `Asset` and `AssetListResponse`.
 * ------------------------------------------------------------------------ */

/**
 * `Asset.sensitivity` widens the four-level scale with `unknown`, which is what
 * the backend stores for an unclassified asset (`Sensitivity` in
 * schemas/assets.py is a five-value Literal).
 */
export type AssetSensitivity = Sensitivity | "unknown";

/** `LifecycleStatus` Literal in backend/app/api/schemas/assets.py. */
export type LifecycleStatus = "active" | "under_review" | "archived" | "pending_disposal";

export interface Asset {
  id: number;
  institution_id: number | null;
  data_source_id: number;
  external_id: string;
  title: string;
  description: string | null;
  record_type: string;
  category: string | null;
  source_type: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
  checksum_sha256: string | null;
  sensitivity: AssetSensitivity;
  contains_personal_data: boolean;
  duplicate_of_id: number | null;
  owner_team: string | null;
  owner_email: string | null;
  lifecycle_status: LifecycleStatus;
  last_reviewed: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The page of assets the server returned, with its own pagination metadata. */
export interface AssetListResponse {
  items: Asset[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

/**
 * Query parameters accepted by `GET /api/v1/assets`.
 *
 * There is deliberately no sort field: the route orders by `updated_at`
 * descending and exposes no ordering parameter.
 */
export interface AssetListQuery {
  page?: number;
  per_page?: number;
  search?: string;
  category?: string;
  sensitivity?: AssetSensitivity;
  source_type?: string;
  lifecycle_status?: LifecycleStatus;
  institution_id?: number;
}

/* ---------------------------------------------------------------------------
 * Phase 3: retention policies, holds, assessments, recommendations.
 * These mirror backend/app/api/schemas/retention.py.
 * ------------------------------------------------------------------------ */

export type Phase3PolicyStatus = "draft" | "approved" | "active" | "retired" | "inactive";
export type PolicyVersionStatus = "draft" | "approved" | "active" | "retired";
export type HoldStatus = "active" | "released";

export type RecommendationState =
  | "RETAIN"
  | "ARCHIVE_RECOMMENDED"
  | "REVIEW_REQUIRED"
  | "DISPOSAL_REVIEW_REQUIRED"
  | "BLOCKED_BY_HOLD"
  | "NO_APPLICABLE_POLICY";

export type FindingSeverity = "informational" | "low" | "medium" | "high" | "blocked";

export interface Policy {
  id: number;
  institution_id: number | null;
  name: string;
  description: string | null;
  applicable_categories: string[] | null;
  retention_trigger: string | null;
  retention_period_days: number | null;
  recommended_action: string | null;
  status: Phase3PolicyStatus;
  scope_description: string | null;
  current_version_id: number | null;
  version: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PolicyVersion {
  id: number;
  policy_id: number;
  version_number: number;
  status: PolicyVersionStatus;
  description: string | null;
  applicable_categories: string[] | null;
  retention_period_days: number | null;
  retention_trigger: string | null;
  conditions: Record<string, unknown> | null;
  recommended_action: string | null;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface Hold {
  id: number;
  institution_id: number | null;
  asset_id: number | null;
  asset_scope: Record<string, unknown> | null;
  name: string;
  hold_type: string | null;
  legal_basis: string | null;
  scope: Record<string, unknown>[] | null;
  status: HoldStatus;
  created_by: string | null;
  created_at: string;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
}

export interface AssessmentFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  evidence: Record<string, unknown> | null;
}

export interface Assessment {
  id?: number | null;
  asset_id: number;
  institution_id?: number | null;
  policy_id: number | null;
  policy_version_id: number | null;
  policy_version_number: number | null;
  rule_set: string;
  assessed_at: string;
  recommendation: RecommendationState;
  rationale: string;
  findings: AssessmentFinding[];
  holds_active: number;
  unresolved_conditions: string[];
  trigger_date?: string | null;
  retention_period_days?: number | null;
  retention_deadline?: string | null;
}

/**
 * Mirrors `RecommendationItem` (`backend/app/api/schemas/retention.py:256`).
 *
 * Every field is always serialized: an optional Pydantic field arrives as
 * `null`, never as `undefined`, so the fields the queue can genuinely leave
 * empty are `| null` rather than `?`. `id` is the assessment this row is the
 * latest of — `services/retention.py` returns `ra.id` — and is what a review
 * decision is recorded against.
 */
export interface RecommendationItem {
  id: number | null;
  asset_id: number;
  asset_title: string | null;
  institution_id: number | null;
  recommendation: RecommendationState;
  rationale: string;
  severity: FindingSeverity | null;
  policy_id: number | null;
  policy_version_id: number | null;
  policy_version_number: number | null;
  holds_active: number;
  assessed_at: string;
  findings: AssessmentFinding[] | null;
  retention_deadline: string | null;
  /** Days past `retention_deadline`; negative while the deadline is ahead. */
  days_overdue: number | null;
  decisions_recorded: number;
  review_status: ReviewStatus | null;
  latest_decision: DecisionValue | null;
}

export interface PaginatedRecommendations {
  items: RecommendationItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

/* ------------------------------------------------------------------------
 * Phase 5: classification and data quality (deterministic, metadata-only)
 * ------------------------------------------------------------------------ */

export type ClassificationOutcome =
  | "classified"
  | "partially_classified"
  | "unclassified";
export type ClassificationConfidence = "high" | "medium" | "low" | "none";
export type ProposedSensitivity =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "unknown";
export type QualitySeverity = "info" | "low" | "medium" | "high";

export interface ClassificationEvidenceItem {
  rule_id: string;
  rule_version: string;
  field: string;
  observed?: string | null;
  proposed_category?: string | null;
  proposed_sensitivity?: string | null;
  note?: string | null;
}

export interface ClassificationConflictItem {
  field: string;
  values: string[];
  resolved_to: string;
  reason: string;
}

export interface ClassificationResult {
  id: number;
  asset_id: number;
  institution_id: number | null;
  rule_version: string;
  outcome: ClassificationOutcome;
  proposed_category: string | null;
  proposed_sensitivity: ProposedSensitivity;
  confidence: ClassificationConfidence;
  confidence_meaning: string;
  evidence: ClassificationEvidenceItem[];
  warnings: string[];
  conflicts: ClassificationConflictItem[];
  input_fingerprint: string;
  created_by: string;
  classified_at: string;
}

export interface ClassificationResultList {
  results: ClassificationResult[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ClassificationRuleDescriptor {
  rule_id: string;
  field: string;
  effect: string;
  confidence: ClassificationConfidence;
  description: string;
}

export interface ClassificationRules {
  rule_version: string;
  rules: ClassificationRuleDescriptor[];
  confidence_meaning: Record<ClassificationConfidence, string>;
  outcomes: ClassificationOutcome[];
  sensitivities: ProposedSensitivity[];
  known_categories: string[];
  severities: QualitySeverity[];
}

export interface QualityFinding {
  asset_id: number;
  check: string;
  severity: QualitySeverity;
  message: string;
  fields: string[];
  evidence: Record<string, unknown>;
  remediation: string;
  duplicate_status?: string | null;
  related_asset_id?: number | null;
}

/** One entry of `GET /classification/checks`: a documented check and its intent. */
export interface QualityCheckDescriptor {
  check: string;
  severity: QualitySeverity;
  description: string;
  remediation: string;
}

export interface AssetQualityReport {
  asset_id: number;
  findings: QualityFinding[];
}

export interface PaginatedQualityFindings {
  findings: QualityFinding[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

/* ------------------------------------------------------------------------
 * Phase 6: unified review workflow and asset governance view.
 * Mirror backend/app/api/schemas/governance.py and the Phase 6 additions to
 * backend/app/api/schemas/retention.py.
 * ------------------------------------------------------------------------ */

/** A human review decision. Advisory only: it executes no file operation. */
export type DecisionValue =
  | "retain"
  | "request_more_information"
  | "approve_for_later_workflow"
  | "reject";

export type ReviewStatus = "open" | "decided";

export interface Decision {
  id: number;
  assessment_id: number;
  asset_id: number;
  institution_id: number | null;
  policy_id: number | null;
  policy_version_id: number | null;
  recommendation_reviewed: RecommendationState;
  decision: DecisionValue;
  reason: string;
  reviewer: string;
  decided_at: string;
  /** The earlier decision this one corrects. Null for an original decision. */
  supersedes_decision_id: number | null;
  /** True once a later decision superseded this one. Superseded rows stay. */
  is_superseded: boolean;
  /** The replacement decision, derived server-side from the supersede link. */
  superseded_by_decision_id: number | null;
}

export interface DecisionInput {
  decision: DecisionValue;
  reason: string;
  /** Optional correction: the earlier decision this one replaces. */
  supersedes_decision_id?: number | null;
  expected_assessed_at?: string | null;
  expected_policy_version_id?: number | null;
  expected_holds_active?: number | null;
}

export interface GovernanceSourceMapping {
  mapping_id: number;
  source_key: string;
  data_source_id: number;
  checksum_sha256: string | null;
  observation_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  source_modified_at: string | null;
}

export interface GovernanceScanSummary {
  scan_job_id: number;
  status: string;
  total_discovered: number;
  total_imported: number;
  total_skipped: number;
  total_errors: number;
  requested_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  error_message: string | null;
}

export interface GovernanceSourceInfo {
  data_source_id: number;
  data_source_name: string | null;
  source_type: string | null;
  connector_type: string | null;
  institution_id: number | null;
  mapping_present: boolean;
  mappings: GovernanceSourceMapping[];
  latest_scan: GovernanceScanSummary | null;
  notes: string[];
}

export interface GovernancePolicyContext {
  policy_id: number;
  name: string;
  status: string;
  version_id: number | null;
  version_number: number | null;
  retention_period_days: number | null;
  retention_trigger: string | null;
  recommended_action: string | null;
  applicable_categories: string[] | null;
}

export interface GovernanceReviewContext {
  latest_assessment_id: number | null;
  expected_assessed_at: string | null;
  expected_policy_version_id: number | null;
  expected_holds_active: number | null;
  decisions_recorded: number;
}

export interface GovernanceProvenance {
  observed: string[];
  system_proposed: string[];
  assessed: string[];
  human_decisions: string[];
  file_operations: string;
}

/** Asset metadata as returned by the governance view (backend Asset schema). */
export interface GovernanceAsset {
  id: number;
  institution_id: number | null;
  data_source_id: number;
  external_id: string;
  title: string;
  description: string | null;
  record_type: string;
  category: string | null;
  source_type: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
  checksum_sha256: string | null;
  sensitivity: string;
  contains_personal_data: boolean;
  duplicate_of_id: number | null;
  owner_team: string | null;
  owner_email: string | null;
  lifecycle_status: string;
  last_reviewed: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GovernanceDetail {
  asset: GovernanceAsset;
  source: GovernanceSourceInfo;
  classification: ClassificationResult | null;
  quality_findings: QualityFinding[];
  applicable_policy: GovernancePolicyContext | null;
  latest_assessment: Assessment | null;
  assessment_history: Assessment[];
  active_holds: Hold[];
  decisions: Decision[];
  /** The decision currently governing this asset: the head of the supersession chain. */
  effective_decision_id: number | null;
  review_context: GovernanceReviewContext;
  provenance: GovernanceProvenance;
}

/* ------------------------- authentication (Phase 7) ------------------------ */
// Mirrors backend/app/api/schemas/auth.py (ADR-0014). Authorization is always
// derived server-side from the local user directory; the permissions below are
// the verified result of GET /auth/me, never a client-side claim.

export type RoleValue = "viewer" | "reviewer" | "admin";

/** Verified permission strings returned by the server for the signed-in user. */
export type Permission =
  | "inventory:read"
  | "governance:read"
  | "retention:read"
  | "sources:read"
  | "retention:assess"
  | "review:decide"
  | "retention:write"
  | "sources:write"
  | "assets:write"
  | "classification:write"
  | "users:manage";

/** Public: what kind of authentication this deployment actually has. */
export interface AuthConfig {
  environment: string;
  /**
   * - `development` — local dev sign-in is available (never in production).
   * - `clerk` — session tokens come from Clerk and are verified here with
   *   RS256; sign-in happens at Clerk, so this API exposes no sign-in form.
   * - `bearer_boundary` — tokens are verified, but no identity provider or
   *   browser sign-in is configured.
   * - `unconfigured` — protected endpoints return 503 until an operator
   *   configures the signing secret.
   */
  authentication: "development" | "clerk" | "bearer_boundary" | "unconfigured";
  dev_login_enabled: boolean;
  /** Which identity provider the server trusts: `clerk`, `local`, or none. */
  identity_provider: "clerk" | "local" | "none";
  issuer: string;
  audience: string;
  token_ttl_seconds: number;
  description: string;
}

/** GET /auth/me: the verified identity behind the current bearer token. */
export interface UserProfile {
  id: number;
  email: string;
  display_name: string;
  role: RoleValue | null;
  is_platform_admin: boolean;
  /** Institution memberships; the backend resolves scope from this directory. */
  institutions: number[];
  permissions: Permission[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

/** Development/test sign-in body. Refused by the server in production. */
export interface DevLoginRequest {
  email: string;
  display_name?: string;
  institution_id?: number;
  role?: RoleValue;
  platform_admin?: boolean;
}

/* ------------------------------------------------------------------------
 * Dashboard summary (GET /api/v1/dashboard/summary).
 * Mirrors backend/app/api/schemas/dashboard.py. Every distribution always
 * includes every known key, with an explicit zero, so the UI can render stable
 * charts instead of omitting empty categories.
 * ------------------------------------------------------------------------ */

export type ScanStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "CANCELLED";

export interface DashboardSummary {
  institution_id: number | null;
  total_assets: number;
  lifecycle: Record<LifecycleStatus, number>;
  sensitivity: Record<AssetSensitivity, number>;
  risk_bands: Record<RiskBand, number>;
  active_policies: number;
  active_holds: number;
  assessments: number;
  decisions: number;
  recommendations: Record<RecommendationState, number>;
  scan_jobs: Record<ScanStatus, number>;
  scanned_records: number;
}

/* ------------------------------------------------------------------------
 * Documented risk indicators (GET /api/v1/risk/*).
 * Mirrors backend/app/api/schemas/risk.py. Scores are stored server-side by
 * app.services.risk; the browser never calculates or invents one.
 * ------------------------------------------------------------------------ */

export interface RiskIndicator {
  code: string;
  label: string;
  points: number;
  explanation: string;
}

export interface RiskAssessmentItem {
  id: number;
  asset_id: number;
  asset_title: string;
  external_id: string;
  institution_id: number | null;
  rule_set: string;
  score: number;
  band: RiskBand;
  indicators: RiskIndicator[];
  assessed_at: string;
}

export interface RiskAssessmentList {
  items: RiskAssessmentItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface RiskAssessmentQuery {
  page?: number;
  per_page?: number;
  band?: RiskBand;
  search?: string;
  institution_id?: number;
}

export interface RiskRuleDescriptor {
  code: string;
  label: string;
  points: number;
  condition: string;
}

export interface RiskBandDescriptor {
  band: RiskBand;
  minimum: number;
  maximum: number;
}

export interface RiskRules {
  rule_set: string;
  maximum_score: number;
  bands: RiskBandDescriptor[];
  rules: RiskRuleDescriptor[];
}

/* ------------------------------------------------------------------------
 * Directory management (GET/POST/PATCH/PUT /api/v1/users).
 * Mirrors backend/app/api/schemas/auth.py. These are local authorization
 * accounts; no password, invitation or institutional identity is handled here.
 * ------------------------------------------------------------------------ */

export interface Membership {
  id: number;
  app_user_id: number;
  institution_id: number;
  role: RoleValue;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface DirectoryUser {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  is_platform_admin: boolean;
  memberships: Membership[];
}

export interface DirectoryUserCreate {
  email: string;
  display_name: string;
  is_platform_admin?: boolean;
}

export interface DirectoryUserUpdate {
  display_name?: string;
  is_active?: boolean;
  is_platform_admin?: boolean;
}

export interface MembershipUpsert {
  institution_id: number;
  role: RoleValue;
  is_active?: boolean;
}

/* ------------------------------------------------------------------------
 * Sources and scan jobs (/api/v1/sources, /api/v1/scan-jobs).
 * Mirrors backend/app/api/schemas/connectors.py. Local-folder sources are
 * addressed by a server-side allow-list key; no absolute path or secret is
 * accepted from or returned to the browser.
 * ------------------------------------------------------------------------ */

export type ConnectorType = "synthetic" | "local_folder";
export type SourceStatus = "active" | "inactive";
export type ScanStatusValue =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "CANCELLED";

export interface Source {
  id: number;
  institution_id: number | null;
  name: string;
  connector_type: string | null;
  root_key: string | null;
  config: Record<string, unknown> | null;
  status: SourceStatus;
  created_by: string;
  last_validated_at: string | null;
  last_validation_ok: boolean | null;
  last_validation_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedSources {
  items: Source[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface SourceCreate {
  name: string;
  connector_type: ConnectorType;
  institution_id?: number;
  config?: Record<string, unknown>;
}

export interface SourceValidationResult {
  id: number;
  ok: boolean;
  message: string;
  validated_at: string | null;
}

export interface ScanJob {
  id: number;
  data_source_id: number;
  institution_id: number | null;
  status: ScanStatusValue;
  batch_size: number;
  total_discovered: number;
  total_imported: number;
  total_skipped: number;
  total_errors: number;
  retried_from_job_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PaginatedScanJobs {
  items: ScanJob[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface ScanResult {
  id: number;
  scan_job_id: number;
  source_key: string;
  status: string;
  title: string;
  record_type: string;
  category: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
  sensitivity: string;
  contains_personal_data: boolean;
  imported_asset_id: number | null;
  note: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PaginatedScanResults {
  items: ScanResult[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface AssetCreateInput {
  institution_id?: number;
  data_source_id: number;
  external_id: string;
  title: string;
  description?: string | null;
  record_type: string;
  category?: string | null;
  source_type?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number;
  sensitivity: AssetSensitivity;
  contains_personal_data?: boolean;
  owner_team?: string | null;
  owner_email?: string | null;
  lifecycle_status?: LifecycleStatus;
  last_reviewed?: string | null;
}

export interface AssetUpdateInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  sensitivity?: AssetSensitivity;
  contains_personal_data?: boolean;
  owner_team?: string | null;
  owner_email?: string | null;
  lifecycle_status?: LifecycleStatus;
  last_reviewed?: string | null;
  size_bytes?: number;
  mime_type?: string | null;
  file_name?: string | null;
}

export interface SourceQuery {
  page?: number;
  per_page?: number;
  status?: SourceStatus;
  institution_id?: number;
}

export interface ScanJobQuery {
  page?: number;
  per_page?: number;
  data_source_id?: number;
  status?: ScanStatusValue;
  institution_id?: number;
}

export interface ScanRequestInput {
  batch_size?: number;
  run?: boolean;
}

export interface ScanError {
  id: number;
  scan_job_id: number;
  source_key: string | null;
  path: string | null;
  error_message: string;
  severity: string;
  created_at: string;
}

export interface PaginatedScanErrors {
  items: ScanError[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}
