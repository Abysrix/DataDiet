---

## ADR-0010 — Production write guards for governance endpoints

*Status (Phase 7): condition resolved by ADR-0014. The per-endpoint write
guards are retired; every protected route (reads and writes alike) now goes
through the authorization layer, which fails closed in production with 503
`auth_not_configured:` when no signing secret is configured. Identity is
server-verified and no client-supplied field is ever trusted.*

**Decision.** There is no authentication/authorization implementation yet. In `ENVIRONMENT=production`, endpoints that create/update/activate/release governance objects return HTTP 503. The client-supplied `institution_id` (or any other field) is never trusted as proof of identity or access.

Covered endpoints: retention policies, policy versions, policy activation, holds (create/release), asset assessment runs and decisions creation (retention governance writes). Classification runs are also guarded (see ADR-0012). Read-only endpoints and the health/readiness probes remain available.

**Why.** Prevents acting on institutional data or exposing governance operations in an environment where no real user/institution context exists. This honors the safety rules (never claim capability, never bypass approvals) while keeping the system demoable in development/test.

**Consequences.** Deployment to production must first provide a real authN/authZ layer (and identity context) before removing these guards. Operations teams see a clear, machine-readable 503 with an explanation when they attempt writes.

---

## ADR-0011 — Connector provisioning remains out of scope until auth context exists

*Status (Phase 7): the production guard is retired into ADR-0014's fail-closed
auth layer; connector provisioning itself remains out of scope — a verified
identity does not conjure a real institutional integration.*

**Decision.** Connector write endpoints return HTTP 503 in `ENVIRONMENT=production` until a real authenticated user/institution context exists. No connector "provisioning" UI, no automatic scanning, and no file movement are exposed.

**Why.** Connecting to real institutional systems or transmitting metadata requires verified identity, scope enforcement, and an allowlist; inventing a connector would violate "never fabricate an integration".

**Consequences.** `GET /api/v1/connectors/sources` returning an empty list remains honest in Phase 5 (no connectors configured).

---

## ADR-0012 — Classification and data-quality analysis are metadata-only and advisory; runs guarded in production

*Status (Phase 7): the run-endpoint guard is retired into ADR-0014's
fail-closed auth layer; a classification run now requires the admin role's
`classification:write` permission. All metadata-only/advisory properties below
are unchanged.*

**Decision.** Classification is deterministic, explainable, and never reads file contents, never transmits metadata outside the system, never mutates asset fields (category/sensitivity), never selects/executes retention policy, never triggers lifecycle actions (archive/disposal/retrieval/move). 

Key properties:
- Rules are versioned (`RULE_VERSION = "classification-v1"`) in code (not runtime-editable); rule changes ship via code review. 
- `ClassificationResult` is immutable, append-only with `input_fingerprint` (SHA-256 over canonical inputs + rule version) and uniqueness `(asset_id, rule_version, input_fingerprint)` enabling idempotent re-runs. 
- Confidence levels documented (`high/medium/low/none`); conflicts cap confidence and resolve with protective tie-break; "unknown"/insufficient evidence → explicit `unclassified`/`unknown`, never silently low. Extension/filename never proves contents (warnings). 
- Data-quality checks (missing metadata, invalid/unsupported extensions, conflicting values, possible/confirmed duplicates, stale observations, inconsistent source mappings, unclassified) are computed on demand; duplicates are flagged but never merged/deleted. Missing metadata ≠ proof of low sensitivity. 
- Write runs (`POST /api/v1/classification/assets/{asset_id}`) return HTTP 503 in `ENVIRONMENT=production` until a real authenticated user/institution context exists. Reads (rules, latest, history, per-asset quality, paginated findings, checks) are safe for display in dev/test. All classification events are recorded in audit trail. 

**Why.** Meets Phase 5 requirements while preserving all Phase 1-4.1 safety guarantees (advisory-only, synthetic-only development, no content scanning, no external AI, no destructive/automatic operations). 

**Consequences.** Classification history persists across rule changes (each result stores rule version). Frontend shows proposals and findings only; human approval remains in retention assessment/review flows. MySQL migration/integration tests may be skipped when `MIGRATION_TEST_DB_URL` unavailable (documented).

---

## ADR-0013 — Unified review workflow: append-only decisions, optimistic concurrency, and no execution path

**Decision.** Phase 6 unifies the review workflow without adding a second source of truth for decisions or assessments:

- **Reuse, not duplication.** The human decision record stays the existing append-only `retention_decisions` table (`RetentionDecision`). No new decision/assessment-history table is introduced. `"reject"` is added to the `DecisionValue` vocabulary (the column is `String(40)` with no CHECK, so no schema change) and the queue/aggregation reuse the existing assessment, hold, policy, classification, and data-quality services.
- **One decision per assessment, race-safe.** Migration `0007_review_decision_integrity` replaces the non-unique `ix_retention_decisions_assessment_id` index with the unique constraint `uq_retention_decisions_assessment_id`. A concurrent double-submit therefore fails at the database (mapped to HTTP 409) instead of creating a second row. History is never edited or erased.
- **Supersession.** Correcting a decision is an explicit supersession: the asset is re-assessed (a new immutable `RetentionAssessment` row) and the reviewer decides on the new assessment. A decision against an obsolete assessment is refused when the client opts into freshness tokens (below), so approval cannot silently ride an out-of-date assessment.
- **Optimistic concurrency.** The review form submits `expected_assessed_at`, `expected_policy_version_id`, and `expected_holds_active` — the versions and hold count it displayed. The server verifies them and returns **409 `stale_review_conflict`** when the assessment was replaced by a newer one, the applicable policy moved to a new active version, or the active-hold state changed. Stale conflicts are recorded in the audit trail and no decision is written.
- **Hold invariant.** Approving a recommendation for a later workflow (`approve_for_later_workflow`) is refused with **409 `hold_conflict`** while any active hold blocks the asset. Active holds override incompatible lifecycle-advancing recommendations. `retain`, `request_more_information`, and `reject` remain available. Hold state is always recomputed server-side; the client's hold value is never trusted.
- **Rationale enforcement.** Rejection and information requests require a substantive rationale (≥ 10 characters), validated in the request schema and enforced again by the service. The free-text rationale is stored on the decision row and is deliberately **not** copied into the audit payload.
- **Transactional audit.** `audit.record_event(..., commit=False)` lets the decision row and its audit events (`review.decision_created`, plus `review.decision_rejected` / `review.information_requested`) commit in a single transaction; a partial write cannot leave governance history inconsistent.
- **A decision is not an execution command.** Recording any decision — including approval — performs no archive, restore, move, or delete. The unified view states this explicitly (`provenance.file_operations`), and no file-operation endpoint exists.
- **Tenant scope.** Every nested lookup validates the optional `institution_id` against the resource and reports a mismatch as 404 (scope membership is not disclosed). This is validation, not authorization: at the time of ADR-0013 all governance writes returned 503 in `ENVIRONMENT=production` until a real identity context existed (ADR-0010); Phase 7 replaced that historical guard with permission plus institution-scope checks (ADR-0014).
- **Read auditing.** Existing convention does not audit reads; the review-queue and governance-view reads are therefore not audited. State changes (decisions, rejections, information requests, stale/hold conflicts) are.

**Why.** The requirements demand an append-only, tamper-evident review workflow with server-enforced invariants and safe failure. Reusing the Phase 3 decision/assessment subsystem avoids divergent histories, and database-enforced uniqueness plus optimistic-concurrency tokens close the concurrency and staleness gaps without inventing an execution capability the system does not have.

**Consequences.** The review queue exposes a `severity` derived as the categorical maximum of the latest assessment's finding severities (documented vocabulary, not an invented score) and a `review_status` (`open`/`decided`) derived from the decision history. MySQL migration/integration tests for `0007` are skipped when `MIGRATION_TEST_DB_URL` is unavailable (documented). 

---

## ADR-0014 — Identity, authentication, and authorization (Phase 7)

**Decision.** Phase 7 adds server-verified identity and a minimal role/permission model, implemented as the
resource-server half of OIDC with **strict HS256 JWT bearer tokens, stdlib only** (no PyJWT/jose dependency):

- **Token verification.** `app/core/security.py` verifies exactly three base64url segments, the algorithm from a
  module constant (`ALGORITHM = "HS256"`, never from the token header), the signature via `hmac.compare_digest`,
  and the required claims `iss`, `aud`, `exp`, `sub` (`current >= exp` is expired; `nbf` when present).
  Every failure maps to a stable machine-readable prefix (`malformed_token`, `invalid_signature`,
  `token_expired`, `invalid_issuer`, `invalid_audience`, `missing_claims`, `unsupported_algorithm`, …) returned
  as 401 with no token content echoed.
- **No RS256/JWKS on purpose.** Real OIDC federation (RS256 + JWKS discovery) is *not* implemented, so
  production stays fail-closed and no identity provider can be claimed as configured when it is not. An
  operator integration boundary exists (the token contract above) and a deterministic development provider
  (`POST /api/v1/auth/dev-login`) issues real tokens through the same verification path; it is hard-disabled in
  production (`sign_in_unavailable:` 503).
- **Fail closed.** In `ENVIRONMENT=production` with no `AUTH_JWT_SECRET` (or the dev placeholder), every
  protected route — reads and writes alike — returns 503 `auth_not_configured:` at request time
  (`require_auth_configured`). Outside production an empty secret auto-fills with a well-known development
  value. `GET /api/v1/auth/config` (public) reports the honest mode: `development`, `bearer_boundary`, or
  `unconfigured`.
- **Directory is authoritative.** Token claims about institution/role are never used for authorization.
  `_resolve_subject` resolves `email` claim or numeric `sub` against the `app_users` / `user_memberships`
  directory; an unmatched identifier is `unknown_account` (401), an inactive account is refused, and the
  server-derived identity (never client-supplied `reviewer` text) becomes the decision actor.
- **One dependency, every protected route.** `require_permission(PERMISSION_*)` (backed by
  `resolve_institution_scope` / `ensure_institution_access`) is applied uniformly: nested IDs are checked
  against the caller's memberships; an out-of-scope resource is reported as **404** (`out_of_scope` /
  `institution_out_of_scope`), never 403, so existence is not leaked across tenants. Denied **writes** are
  audited as `authorization.denied`; denied/failed reads are not audited (extends ADR-0013).
- **Role matrix (documented, minimal).** `viewer` = `inventory:read`, `governance:read`, `retention:read`,
  `sources:read`; `reviewer` adds `retention:assess`, `review:decide`; `admin` adds `retention:write`,
  `sources:write`, `assets:write`, `classification:write`; `users:manage` and cross-institution scope require
  `is_platform_admin`. Multiple memberships without an explicit `institution_id` on a scoped list endpoint
  return **422** (`institution_id is required`) rather than silently guessing.
- **Session shape.** Bearer tokens are stateless: sign-out is client-side discard; there is no logout
  endpoint and no cookie/CSRF surface. The frontend stores the token in `localStorage` under
  `datadiet.access_token` (the user's own credential, verified server-side on every request) and renders
  permission-aware navigation/actions as usability only — the backend re-checks everything.
- **User management.** `GET/POST/PATCH /api/v1/users` and membership endpoints require `users:manage`;
  every account or membership change is audited in the same transaction (`users.*`).
  `scripts/bootstrap_admin.py` creates the first platform administrator offline (no HTTP bootstrap in
  production).

**Why.** Phase 7 must retire the production 503 write guards only behind *trusted* authN/authZ. HS256 with a
server-held secret is the smallest verifiable credential system implementable with the existing stdlib-only
dependency set; keeping RS256/JWKS out of scope avoids half-built federation that could be mistaken for a
working IdP integration. Deriving authorization exclusively from the local directory (not token claims)
prevents privilege carried in an issued-but-revoked claim.

**Consequences.** Production endpoints remain 503 until an operator sets a real `AUTH_JWT_SECRET`; when a
real IdP is procured, RS256/JWKS support must be added and tested before claiming OIDC compatibility. The
development provider and paste-a-token sign-in are honest about what they are. Frontend tests inject synthetic
identities via `AuthProvider initialUser`; no real credentials exist anywhere in the repository.

---

## ADR-0015 — Decision supersession: corrections are new decisions, never edits

**Decision.** A wrong human decision is corrected by an explicit supersession, not by editing or deleting
history:

- **Model.** `retention_decisions` gains `supersedes_decision_id` (self-FK, `ON DELETE RESTRICT`) with a
  unique index `uq_retention_decisions_supersedes`, so a decision can replace at most one predecessor and a
  predecessor can be replaced at most once. There is no `superseded_by` column; the replacement is derived by
  join when serializing (`is_superseded`, `superseded_by_decision_id` on the API schema).
- **Validation order (service layer).** institution scope → same asset lineage → no self-reference →
  predecessor must be on a **strictly earlier** assessment of that asset → predecessor not already superseded
  → no cycle (`SUPERSESSION_CHAIN_LIMIT = 200`, defence-in-depth for databases that lost the unique index).
  Failures map to 404 (`supersession_not_found`, `supersession_out_of_scope`) or 409 (`wrong_lineage`,
  `self_reference`, `already_superseded`, `cycle`, `concurrent`).
- **Effective decision.** The governing decision is the head of the supersession chain — the newest decision
  that is not itself superseded (`retention_service.effective_decision_id`), exposed on the governance view
  as `effective_decision_id` and rendered as an "Effective" badge. Superseded decisions stay fully visible in
  history with "Superseded by #N" / "Corrects #N" links.
- **Corrections are fresh assessments.** A superseding decision is always recorded against a *new* assessment
  (the reviewer re-examines current state); the candidates endpoint
  `GET /retention/decisions/supersession/source?assessment_id=` returns the server-computed eligible
  predecessors so the UI can only offer real, already-authorized targets. A substantive rationale (≥ 10
  characters) is required for any supersession, exactly as for rejection.
- **Concurrency.** `IntegrityError` at flush or commit (two reviewers superseding the same decision at once,
  or a second successor racing the unique index) maps to 409 mentioning "concurrent"; nothing is written.
- **Audit.** `review.decision_superseded` and `review.decision_created` are recorded in the same transaction
  as the rows; the free-text reason stays off the audit payload (`reason_length` only). No silent edits or
  deletes exist anywhere in the path — there is no UPDATE or DELETE route for decisions at all.

**Why.** "Preserve the original decision" is a hard requirement, and a self-referencing link is the smallest
schema change that expresses correction without inventing a second history table or a mutable flag. The
unique successor index makes the dangerous states (double replacement) impossible at the database level.

**Consequences.** Migration `0009_decision_supersession` adds the column and index. Cycle prevention is
mostly enforced by the unique index; the service-level chain limit guards degraded databases and bounds
reads. Frontend review history shows superseded/effective markers, and the decision form only opens on the
latest undecided assessment.

---

## ADR-0016 — MySQL migration 0010: forward repair, supported rollback boundary at 0005

**Decision.** Phase 7's investigation of the migration-0005 downgrade defect found three index-before-FK
inversions (`classification_results`, `retention_decisions`, `retention_assessments`). The fix is:

- **Forward repair only, one table.** Migration `0010_classification_downgrade_safety` repairs
  `classification_results` (`classification_results_ibfk_1/_2`: drop the FKs first, then their indexes on
  downgrade; restore only the missing constraints on upgrade, discovered via `information_schema`, so the
  step is idempotent and doubles as the documented repair procedure: `alembic downgrade <one step>` then
  `alembic upgrade head`). `retention_decisions` is deliberately **not** repaired: doing so would strip FKs
  on the supported path (leaving the 0005 schema incomplete) and still could not carry a rollback below 0005
  because `retention_assessments` is unrepairable behind it.
- **Supported rollback boundary = `0005_source_connectors`.** Downgrades to 0005 round-trip cleanly.
  Below the boundary the failure is now *safe*: 0005's downgrade completes, then 0004's first statement
  (`drop_index ix_retention_decisions_institution`) is refused with errno 1553 (index is FK-backed) before
  anything is destroyed, leaving a consistent 0004 state (stamp `0004_review_decisions`) that
  `alembic upgrade head` fully repairs. This behaviour is tested; below-boundary rollback is documented as
  unsupported rather than silently corrupting.
- **Applied history is not rewritten.** Migrations 0001–0009 are untouched; 0008's downgrade gained an
  `ALTER COLUMN role DROP DEFAULT` fix only because 0008 was still uncommitted Phase 7 work at the time.
- **Tested on disposable MySQL.** The suite (`tests/test_migrations_mysql.py`, run when
  `MIGRATION_TEST_DB_URL` is set) covers: head upgrade, FK restrict, nullability, boundary round trip,
  below-boundary safe failure + repair, one-step downgrade, Phase 7 schema, the 0010 repair procedure,
  parametrized partial-rollback gaps at 0009 and 0006, and Phases 4–6 schemas — 14 tests, zero xfails
  against MySQL 8.0.

**Why.** Rewriting applied migrations to tidy the rollback story is explicitly out of scope and risky for
deployed databases; a forward corrective migration plus an enforced, tested boundary gives operators a
predictable recovery path and an honest statement of what is unsupported.

**Consequences.** Operators must not `alembic downgrade` below 0005; the failure mode and the repair
procedure (`upgrade head` from the consistent 0004 state) are documented here and in the migration module.
The parametrized gap tests pin the exact schema remaining after an unsupported partial rollback so any
future change is visible immediately.

---

## ADR-0017 — Revoke the unsafe platform-admin default from Phase 7 migration 0008

**Decision.** Migration `0008_identity_and_authorization` added `app_users.is_platform_admin` with a server default of `TRUE`. This grants platform-wide privileges to pre-existing accounts during the migration and to inserts that omit the field. An institution-scoped `admin` role must not imply platform administration.

Migration `0011_platform_admin_default_false` corrects this without rewriting applied migration history:
- Change the database default to `FALSE`.
- Revoke the platform-admin flag from all existing accounts because the database cannot distinguish an intentional grant from one inherited from the unsafe default.
- Keep the downgrade security-monotonic: it does not restore the unsafe default or privileges.
- Require a trusted database operator to explicitly re-grant platform administration to individually verified accounts after migration.

**Why.** This is a privilege-escalation risk, not a cosmetic default mismatch. Failing closed is preferable to preserving potentially accidental global privileges.

**Consequences.** After upgrading to `0011_platform_admin_default_false`, verify that no unintended platform administrators remain. Any intended platform administrator must be re-granted through a controlled operational procedure. The migration's data correction is intentionally not reversed by downgrade; restoring the old `TRUE` default would recreate the vulnerability. Live MySQL integration tests must verify existing-account revocation and the default for future inserts.

---

## ADR-0018 — Migration preflight is read-only; backups and re-grants are human gates

**Decision.** Add `scripts/migration_preflight.py`, a read-only operator command that reports the configured environment, a credential-free database target, the stamped Alembic revision, the repository head and the pending revisions. It classifies failures with distinct exit codes (2 unreachable, 3 not under Alembic control or ambiguous version table, 4 unknown/off-chain revision, 5 multiple heads) and never applies or writes anything. The migration runbook (`docs/setup.md` §8) requires a test-restored backup and a documented administrator recovery plan before `upgrade head`. Recovery uses the existing offline `scripts/bootstrap_admin.py`, one named account at a time, audited in the same transaction; no HTTP grant endpoint is added.

**Why.** `0011` resets every platform-admin flag, so applying it "and seeing what happens" is unacceptable. `alembic current` reports a revision but not the target or environment, and a hand-typed masking snippet would be untested and easy to get wrong. A small, tested command covers the machine-checkable preflight criteria without new dependencies, while the authorization-critical decisions stay with an operator.

**Consequences.** Existing-database migrations follow a documented procedure. Operators must treat non-zero preflight exit codes as stop signals. The preflight is not wired into `alembic upgrade` and cannot prove a backup exists; it complements, and does not replace, change control. Downgrades remain security-monotonic at `0011` and unsupported below `0005` (ADR-0017, ADR-0016).

---

## ADR-0019 — CI runs on Linux GitHub Actions; the Windows PowerShell gate remains local

**Decision.** Add `.github/workflows/ci.yml`, triggered on every pull request and every push to `main`. It is configured to run on a GitHub-hosted Ubuntu runner with pinned Python 3.14.1 and Node.js 24.13.1, installs `backend/requirements-dev.txt` and the frontend `package-lock.json` (`npm ci`), and runs backend Ruff, operator-script Ruff, backend pytest, the 19-test live MySQL migration suite against an ephemeral `mysql:8.4` service, frontend type checking, Vitest, and the production build. The MySQL step requires `MIGRATION_TEST_DB_URL`, sets `MIGRATION_TEST_ALLOW_DROP=1` only for that step, and asserts that 19 tests pass (not skipped). GitHub Actions are pinned to full commit SHAs with release comments, and the MySQL image is pinned to a verified multi-arch digest. No repository secret or production credential is used, and the job stops at the first failing step.

Extend `scripts/check.ps1` with the same operator-script Ruff invocation (`ruff check ..\scripts` from `backend/`) so the local Windows PowerShell 5.1 gate and CI cover the same operator code. The existing explicit `$LASTEXITCODE` assertions and fail-fast order remain; Ruff's formatter is deliberately not run.

The local gate stays the canonical developer workflow on Windows. CI does not invoke `check.ps1` because the script uses Windows virtual-environment paths; it runs the equivalent commands on Linux. The Windows-only symlink test is expected to execute rather than skip on the Linux runner.

**Why.** The repository had no automated pull-request validation, so correctness depended on a developer remembering to run the local script. The migration suite is the core safety check for `0011` and `0012`, and GitHub's service containers provide a disposable MySQL on Linux without adding a durable test database. Running the same Ruff configuration over `scripts/` closes a gap where operator code was only linted by hand. A single Linux job avoids duplicated test logic and unnecessary services, while the Windows gate remains available for the environment the project is developed in.

**Consequences.** Required status checks and branch protection are repository settings that must be enabled separately; the workflow file alone does not block a merge. Python dependencies are still range-pinned with no lockfile (a lockfile was not added because it could not be validly generated and tested across the supported platforms in this environment), and dependency/secret scanning is not configured; these remain supply-chain gaps (`docs/production-readiness.md`). The workflow has not yet executed on GitHub until a commit is pushed or a pull request is opened. CI validates code, not a deployment: it does not run migrations against a durable database, provision a real identity provider, or prove production configuration.

---

## ADR-0020 — Migration `0012` records the `0011` reset; it does not reconstruct identity

**Decision.** Add forward migration `0012_audit_platform_admin_reset`, which appends one `audit_events` row (`users.platform_admin_reset_recorded`) after `0011` has run. The payload records the reset revision, the post-reset platform-administrator count, and the fact that the operator must preserve a pre-migration export in the change ticket. `0012` changes no account or privilege; the insert is idempotent by event type/entity id, and `downgrade()` is a no-op so the append-only audit row is never deleted.

**Why.** Reverting `0011` or editing its historical behavior would either recreate the accidental privilege grant or leave already-migrated databases without the record. A forward-only migration is safe for both fresh and existing databases, provided it does not pretend to know which identities were revoked. The pre-migration export is the human-owned evidence of the prior grant list; `0012` is durable evidence that the reset revision ran and the post-reset state was observed. Re-granting remains a separate, explicitly audited `bootstrap_admin.py` action.

**Consequences.** Existing databases at `0011` receive the audit row on the next upgrade; databases already at `0012` do not duplicate it. A database where administrators were deliberately re-granted before `0012` records a nonzero post-reset count, which is accurate and must be reconciled with the ticket. `0012` cannot repair a missing pre-migration export and must not be presented as doing so. Live MySQL tests verify the event, the no-privilege-change property, and idempotency across downgrade/re-upgrade.

---

## ADR-0021 — Azure preparation is unvalidated scaffolding; the settings defect it exposed is fixed in code

**Decision.** Prepare the repository for a future Azure migration without touching cloud resources: Bicep infrastructure under `infra/azure/` (one resource-group-scoped entry point, seven modules, dev/prod parameter files), a separate `.github/workflows/azure-deploy.yml` that never triggers on push and gates production behind a protected GitHub environment, and three documents (`docs/azure-architecture.md` with the migration gap analysis, `docs/azure-deployment.md` as the runbook, `docs/azure-cutover-checklist.md` as the gate). `.github/workflows/ci.yml`, all application behaviour, all migrations, and all existing tests are unchanged; the only code change is the CORS settings defect below.

The audit found that a `list[str]` settings field is JSON-decoded inside pydantic-settings' environment/dotenv source **before** any validator runs, so `CORS_ORIGINS=http://localhost:5173` — the value `.env.example` shipped — raised `SettingsError` at startup and only a JSON array was accepted. Because deployed platforms carry flat string application settings, this blocked any Azure startup. `cors_origins` is now `Annotated[list[str], NoDecode]` with a validator accepting the comma-separated **and** the JSON-array forms (malformed JSON is refused, not silently ignored), and the dependency floor is raised to `pydantic-settings>=2.7`, the first release exporting `NoDecode`. Six tests in `backend/tests/test_config_cors_origins.py` cover both forms, whitespace, empty values, and the malformed-JSON rejection.

Naming, region, subscription, tenant, tier, hostname, and network mode are parameters with placeholder values that must fail a deployment until replaced; `nameToken` is the only field an operator must invent. The Key Vault is created **empty**, secrets reach the runtime only through `@Microsoft.KeyVault(SecretUri=...)` references resolved by a user-assigned managed identity holding Key Vault Secrets User and nothing else, and the sole deploy-time secret (`mysqlAdministratorLoginPassword`) is `@secure()` and referenced from an operator-owned bootstrap vault. The three MySQL network modes are all templated, but their private forms are documented as unreachable from the backend until App Service VNet integration exists — which is deliberately **not** templated because the child-resource shape could not be verified offline. Application Insights stays off unless an existing Log Analytics workspace id is supplied, because it bills on ingested volume and the application emits no AI telemetry today.

**Why.** Azure credentials do not exist yet, and the repository's own rules forbid claiming an untested capability (AGENTS.md: never claim a capability that is untested; never fabricate an integration; never expose secrets to the frontend). Scaffolding that is honest about being uncompiled is useful now; scaffolding that pretends to be validated would be a fabrication. Fixing the CORS parsing in code rather than working around it by forcing a JSON value into the template keeps local development unchanged and makes the comma form — the only portable form on a deployed platform — actually work. Choosing parameter files over hardcoded names, and an empty vault over templated secrets, keeps a real subscription's identity and cost decisions with the humans who own them.

**Consequences.** The templates have never been parsed by a Bicep compiler, linted, or `what-if` validated (`az`, `bicep`, and `node`/`npm` are unavailable in the authoring environment and the Bicep download is unreachable), so `infra/azure/README.md` carries an explicit unverified-items table naming the command that resolves each assumption; `az bicep build`/`lint` plus `what-if` are mandatory before the first deployment. `azure-deploy.yml` is pinned to action version tags rather than commit SHAs because `github.com` was unreachable — a documented violation of ADR-0019's convention that must be fixed before the workflow is enabled, not papered over with invented SHAs. Migration approval, least-privilege database roles, TLS verification against a real server, an Azure restore drill, and DNS/certificate issuance remain human steps. Nothing here changes the verdict in `docs/production-readiness.md`: authentication is still HS256-only and fails closed (ADR-0014), so an Azure deployment is not a production-ready service until a real identity provider is implemented and tested.

---

## ADR-0022 — Frontend reads are dependency-declared and cancellable; assessment runs are permission-gated in the UI too

**Decision.** `frontend/src/hooks/useApiQuery.ts` becomes `useApiQuery(fetcher, deps)`, where the fetcher receives the run's `AbortSignal` and `deps` is the explicit list of values the request depends on. React needs a fixed-size dependency array, so the list is folded into a type-tagged structural key (`dependencySignature`) and the effect runs on `[dependencyKey, reloadToken]`; object and array dependencies are compared by content, not identity, so a call site may pass an inline option object without requesting on every render. Each run owns an `AbortController`; the effect cleanup marks the run inactive and aborts it, which cancels the transport for the fetchers that thread the signal into `apiGet(path, signal)` and, for every fetcher, guarantees that a superseded or unmounted run cannot write state. A request that is cancelled is re-thrown as its own `AbortError` rather than wrapped in the "could not reach the API" message. `refetch()` remains an explicit reload that touches no dependency, and the documented state behaviour is unchanged: `loading` starts true, a new attempt clears the previous error while keeping the last data visible, and a failed attempt clears data and sets the message. No dependency-lint suppression remains anywhere in `frontend/src`.

Every one of the sixteen call sites declares its dependencies: `[activeInstitutionId]` for the policy and hold lists, `[assetId]` for assessment history, the classification latest/quality/history cards and the supersession candidates, `[assetId, activeInstitutionId]` for the governance view, the seven queue values (page, institution, recommendation, review status, severity, sort, settled search) for the review queue, and `[]` for the mount-only health, dashboard, inventory, risk and sign-in-config reads. The review queue's `firstRender`/`useEffect` workaround for the old hook is deleted, and its search box is debounced by 300 ms (`useSettledValue`) so typing does not equal one request per keystroke; filter semantics, page-reset behaviour, sort options and the query payload are unchanged. The queue's previous manual re-fetch workaround and the unreactive reads were the defect, not the pages' intent.

`assessAsset` (POST `/api/v1/retention/assess/{asset_id}`) is deliberately **not** given the signal: cancelling the client's view of an accepted mutation would not undo it on the server. `AssetAssessment` now mounts the assessment runner only when `has("retention:assess")` is true; other roles get an explicit "Your role cannot run assessments" state and no POST is issued, while the read-only history stays available because it is a separate permission. `AssetGovernance`'s existing `retention:assess` action gate is unchanged, and no other gate (`retention:write`, `review:decide`, `classification:write`) was moved, added or removed.

**Why.** The previous effect depended only on its internal reload token and captured the fetcher from the first render, so a change of asset id, institution scope or queue filter re-rendered without re-requesting, and the last screen's data stayed on display as if it described the new asset. On the asset pages that is not a cosmetic problem: an assessment or governance view for asset 3 could be shown under an "asset #4" heading, which is exactly the kind of wrong-record confusion the governance product exists to prevent. Making the dependency list explicit moves the contract into the call site where a reviewer can read it, and cancellation plus result suppression closes the out-of-order-response hole that a plain `cancelled` flag left open for slow requests. The assessment gate follows the same reasoning as the existing decision-form gate: the frontend must not offer, or on mount silently perform, a write the account is known not to hold — the backend remains authoritative and re-checks every request, so this is usability, not authorization.

**Consequences.** Read freshness is now the caller's declared responsibility: a value a request depends on must appear in `deps`, and an unlisted value will not re-trigger the request (unit tests pin the signature's behaviour for `undefined`/`null`, numeric and string forms, and content-equal objects). A mutation triggered by a dependency change repeats server work — a viewer cannot trigger it at all now, and a reviewer navigating between assets records one assessment per asset, which matches the page's own "Run assessment" action and is append-only and non-destructive. AbortController cancellation is transport-only: a fetcher that ignores the signal still lets the server finish the request, its result simply cannot reach the screen. No caching, de-duplication or background refetch was added; two components reading the same endpoint still issue two requests. Verified by `frontend/src/hooks/useApiQuery.test.tsx` (18 tests) plus nine page-level regressions in `retention.test.tsx` and `governance.test.tsx` — seven request-lifecycle and two authorization-gate — and by the existing suites, under the frontend typecheck, Vitest run and production build; the behaviour was not exercised against a live backend in this environment, so real network cancellation is reasoned from the `fetch` contract rather than observed.

---

## ADR-0023 — One status vocabulary, a framework-free primitive layer, self-hosted typography

**Decision.** The frontend design system is now three things and no more. (1) *Status meaning* stays in `lib/semantic.ts` (which role a domain value has), and its *appearance* is defined exactly twice: `components/ui/statusClasses.ts` holds `TONE_SURFACE` (fill + ink + ring) and `TONE_SOLID` (bar/dot/progress fill) for all seven roles, and `components/icons.tsx` holds `STATUS_GLYPHS`, keyed by `StatusTone` — the six state roles, with `accent` excluded by the type and folded to `neutral` at runtime by `resolveStatusTone`. `Badge`, `BarList`, `Progress` and `Toast` all read those tables instead of carrying their own. (2) *Primitives*: `Button`, `IconButton`, `Input`, `Select`, `Textarea`, `Field`, `Table`/`TableHead`/`TableBody`/`TableRow`/`TableHeaderCell`/`TableCell`, `Dialog`, `Tabs`, `Toast`/`ToastProvider`/`useToast` and `Progress`, written against the `@theme` tokens with hand-rolled focus trap, arrow-key tablist and live-region behaviour. No MUI/Radix/Ant, no charting dependency, no dark mode, no new npm dependency. `index.css` gains the roles those controls need — focus, on-accent, disabled surface/ink/line, overlay scrim, overlay radius, overlay/toast shadows, control/row/stack/page spacing, two named animations, a base `:focus-visible` outline and a `prefers-reduced-motion` guard. (3) *Typography* is self-hosted: Inter 400/500/600/700 latin `woff2` (pinned `@fontsource/inter@5.3.0`, ~96 kB total) in `src/assets/fonts/` with the SIL OFL text, declared by four `@font-face` rules with `unicode-range` and `font-display: swap`; the built stylesheet references only same-origin `/assets/*.woff2`, so no font request leaves the deployment. `ToastProvider` is mounted once in `App.tsx` above the router — a provider element only: no route, layout, page or permission gate changed, and no page calls `useToast()` yet.

**Why.** Four near-copies of the tone table (two of them untested) and a separate page-local colour choice per status were how the pre-token code drifted into `draft` being amber in one screen and slate in another; one meaning table plus one appearance table plus one glyph table makes that impossible to repeat. The primitives exist before the pages use them so each route can be migrated on its own, without a big-bang rewrite and without deleting a component that a page still imports. A runtime font CDN would be an outbound dependency for a tool meant to run inside an institution's network, and it is the reason the old `Inter` declaration silently never applied.

**Consequences.** The primitives are covered by 74 new tests (`Button`/`IconButton`, `Field` with `Input`/`Select`/`Textarea`, `Dialog`, `Tabs`, `Toast`, `Table`, `Progress`, `semantic`, and a cross-surface status test), `scripts/check.ps1` passes end to end on portable Node 24 (backend and operator-script Ruff, pytest 222 passed / 20 skipped, typecheck, Vitest 213/213, production build — exit 0), and the token layer was checked in a browser against the dev server: the four Inter weights load, the notification live region is present with `aria-live="polite"`, and the sign-in page renders with no console error from the new code. What is *not* proven: no production route renders a primitive yet, so their visual integration rests on the component tests and on markup injected into the dev page, not on a redesigned screen; page markup still contains its own raw palette classes (`text-slate-500` and friends), which are removed route by route in the page phases; the base-layer focus outline means a page that sets `outline: none` loses its only indicator; and the ~96 kB of fonts is now part of the deployable artifact and must be committed with the phase.

---

## ADR-0024 — One modal behaviour for both overlays; navigation state expressed by our own `aria-current`; breadcrumbs earn their link

**Decision.** The Phase 4 shell rests on five choices. (1) *One measure, two navigation regions.* `Layout.tsx` defines `CONTAINER` (`mx-auto w-full max-w-[80rem] px-4 sm:px-gutter wide:max-w-[88rem] wide:px-page`) and uses it for the header row, `<main>` and the footer, so the sidebar rule, the title, the content and the disclaimer all align on one column. The persistent rail is a fixed `w-64` `<aside aria-label="Sidebar">` from `lg` (1024px); below it the same body renders inside a `w-72 max-w-[85vw]` drawer. `index.css` gains `--breakpoint-wide: 90rem` so the extra-large step is a Tailwind-generated `wide:` variant rather than hand-written media CSS. (2) *One modal implementation.* `components/ui/overlayBehavior.ts` exports `useOverlayBehavior({ open, panelRef, onClose, initialFocusRef })` — focus-in and restore (only while the previous element is still in the document), `body.style.overflow` lock, Escape to close, Tab containment at both ends — extracted verbatim from `Dialog`, which now calls it with an unchanged public API, and used by the mobile drawer. (3) *Navigation state is ours to express.* `NavRow` renders a `Link` with an explicit `aria-current={isPage ? "page" : isCurrent ? "true" : undefined}` instead of a `NavLink`, because React Router computes `aria-current` itself and drops the caller's value whenever its own `isActive` is false — which cannot express "this row *is* the page" versus "this row's *area* owns the current route" (an asset-detail page marks its parent area without pretending the parent is the page). Group headings are `<p>` elements, and the header's title and description are `<p>` elements, never headings. (4) *A breadcrumb is a navigation affordance, so it must not grant one.* `findDetailRoute()` recognises the two single-asset routes (`/assessments/{id}` from `nav.ts`'s `DETAIL_ROUTES`, `/governance/assets/{id}`) and the header renders `DetailBreadcrumb`, whose parent segment is a `Link` only when `has(parent.permission)` is true for the signed-in account — otherwise it is `aria-hidden` text — and whose asset segment is `aria-current="page"` text with a separator marked `aria-hidden`. The asset label comes from the URL segment (`Asset #12`), not from a new request. (5) *The shell keeps its own honesty and its dark-surface controls.* The two-line "No destructive actions enabled / Archiving and disposal are not implemented" notice and the footer disclaimer travel with the shell verbatim; the user panel keeps the exact scope semantics (selector only for a platform admin or an account with more than one institution, "All institutions" only for platform admins, `setActiveInstitution` unchanged) with a visible "Institution scope" label, and `IconButton` gains an `inverse` variant so a control on the dark rail meets contrast without a page-local colour.

**Why.** Before this phase the drawer was a second, hand-rolled copy of the sidebar with no focus management, no Escape handling, no scroll lock and no `aria-expanded` — a keyboard user could Tab into a panel that was visually gone, and a screen-reader user had no way to know the toggle opened anything. Duplicating `Dialog`'s trap would have recreated exactly the drift the Phase 3 system exists to prevent, so the behaviour was extracted once and both overlays now inherit any fix. The flat eleven-link list mixed "look" and "act" stages of the same lifecycle; the four groups (Discover / Retain & review / Archive & report / Administer) describe the pipeline, and because they are derived from the same `NAV_ITEMS` list, permission filtering stays a single function. The header needed to say where the user is without competing with the page: a second heading reading "Retention Policies" above a `PageHeader` H1 of the same words is a duplicate in the accessibility tree, so the shell uses non-heading text and the page keeps the only H1.

**Consequences.** `Layout.test.tsx` grows from 7 to 38 tests and now pins: permission-aware grouping (and omission of an empty group), `aria-current="page"` on the active row with the parent area marked `"true"` while the breadcrumb link carries neither, nothing current on an unknown route, sign-out clearing identity but not the navigation, the honesty notice inside the sidebar, exactly one `banner`/`main`/`complementary`/`contentinfo` and no heading in the header, the skip link as the first anchor with a focusable `<main id="main-content">`, route-specific title and description with a fallback, breadcrumb contents and its permission rule, the three scope-selector variants and re-scoping, and the drawer's full keyboard contract (dialog semantics, focus in and restored to the toggle on Escape, Tab wrapping both directions, close via Escape, close button and backdrop, closing after choosing a destination, and the scroll lock). Because `aria-current` is now owned by our code rather than the router, a future change back to `NavLink` would silently lose the area-level marker — the test is what prevents that. `SidebarContent` mounts twice (rail and drawer), so any shell query must be scoped with `within()`; jsdom applies no CSS, so responsive show/hide is *not* test-proven and rests on the browser inspection at 456/1024/1280/1440 px. The `wide:` variant is a project convention, not a Tailwind default, and pages that adopt the shell measure need it documented. The shell is redesigned and the pages inside it are not: each route still renders its own Phase 0 markup and raw palette classes (`PageHeader` changed only its bottom margin), so a new frame around an un-redesigned screen is the expected intermediate state until the page phases. No URL path, permission check, institution-scope rule, authentication or session-expiry behaviour, API contract, backend file, dependency, dark-mode implementation or mock dataset changed.

---

## ADR-0025 — Clerk verifies who is calling; DataDiet's directory decides what they may do

**Decision.** Six choices make Phase 6.0 safe to run. (1) *The API is a Clerk resource server, nothing more.* `core/jwks.py` verifies Clerk session tokens with `ALLOWED_ALGORITHMS = ("RS256",)` — a fixed list, never the token's own `alg` header — so an `HS256` token cannot be promoted into the Clerk path under any configuration. Keys come from the issuer's `/.well-known/jwks.json`, are cached (`DEFAULT_TTL_SECONDS = 300.0`, per-URL `lru_cache`, HTTPS required except loopback, `DEFAULT_TIMEOUT_SECONDS = 5.0`), and a cache miss on an unknown `kid` triggers at most one refresh per `DEFAULT_MIN_REFRESH_INTERVAL_SECONDS = 30.0`; a failed fetch keeps the previously cached keys, so a Clerk outage does not sign out identities that were working seconds earlier. PyJWT's own verifier does the cryptographic work — no custom primitives — and `PyJWT[crypto]` is pinned in `requirements.txt`. There is deliberately **no** `CLERK_SECRET_KEY`: this API never calls Clerk's server-side endpoints, so it holds no Clerk credential to leak. (2) *The provider identifies; the directory authorizes.* Clerk's `sub` maps through the new `external_identities` table (`0014_external_identities`: `provider` + `external_subject` unique, `app_user_id` FK `CASCADE`, `last_email`, `bound_by`), never through email — an email change refreshes `last_email` and cannot create a second account. Binding is an operator action (`scripts/bind_clerk_identity.py bind|unbind|list`, audited as `users.clerk_identity_bound` / `_rebound` / `_unbound`, `--allow-rebind` required to move a subject, `--confirm` required to unbind) that grants nothing by itself: roles, institution memberships and the platform-admin flag stay exclusively `app_user`/`user_memberships` facts, and Clerk user or public metadata is never read for authorization. `CLERK_AUTO_PROVISION` defaults to **false**; when an operator enables it, an unknown subject may receive a *permissionless* account — never an institution membership, never administration. (3) *Fail closed, in a stated order.* `core/auth.py` resolves the live path from configuration, not from a request field: Clerk when `CLERK_ISSUER` is set (and then Clerk only — a token that fails RS256 verification is refused, never retried against the HS256 secret), otherwise the ADR-0014 bearer boundary when a real `AUTH_JWT_SECRET` exists, otherwise 503 `auth_not_configured:` on every protected route while `/health` and `/health/ready` stay public. Stable machine prefixes — `auth_not_configured`, `sign_in_unavailable`, `identity_provider_unavailable`, `invalid_token`, `unknown_account` — let the frontend quote the server instead of inventing a reason. "Clerk wins" is enforced twice over: with `CLERK_ISSUER` set the dev-login handler reports itself disabled and self-refuses 503 *before* touching the database or the audit log, and `create_app` registers `auth.dev_router` only when `not settings.protected_environment`, so in staging/production `POST /api/v1/auth/dev-login` is absent from the OpenAPI schema and answers 404 rather than being a route that exists and complains. (4) *PostgreSQL enters the existing history through a baseline, not a rewrite.* `0013_postgresql_baseline` creates the same 20 tables that MySQL accumulated across `0001`–`0012`, returns immediately when `op.get_bind().dialect.name != "postgresql"`, and widens `alembic_version.version_num` to `String(64)` for the 38-character revision ids; a fresh PostgreSQL database is stamped at `0012_audit_platform_admin_reset` and then upgraded, while an existing MySQL database replays `0013` as a no-op. No already-applied revision was edited, there is still exactly one head, `0013`'s downgrade raises instead of dropping the baseline (forward-only), and `scripts/migration_preflight.py` is now dialect-aware (`SUPPORTED_BACKENDS = {"mysql", "postgresql"}`, exit 6 for anything else, with the stamp-then-upgrade entry path printed only for a PostgreSQL target). (5) *One frontend seam, no second credential.* `auth/externalSession.ts` is the only module that knows a provider exists; `auth/ClerkBoundary.tsx` mounts Clerk's supported `ClerkProvider`/`SignIn` solely when the build was given `VITE_CLERK_PUBLISHABLE_KEY`, publishes the session's lifecycle, and resolves a token *per request* into `api/client.ts`'s new asynchronous access-token provider. DataDiet never stores a Clerk token — `setAccessToken(null)` runs when a provider mounts, so a leftover development credential cannot masquerade as a staging session — and the 401 → forced-sign-out subscription, the protected-route structure, and `GET /auth/me` as the sole source of permissions are unchanged. (6) *Staging is prepared, not deployed.* `docs/render-staging.md` documents the Render services, health path, secret names and the human-triggered migration command; nothing was created on Render in this phase and Floci stays undeployed by design.

**Why.** The previous boundary (ADR-0014) verified tokens this API signed itself, which is enough for a demo but not for a hosted staging environment: it would mean building, storing and rotating a password system for a project whose entire value is *not* holding personal data. Clerk takes the identity surface, and the split keeps the dangerous part out of scope — the API holds only a public JWKS, so the worst case of a frontend compromise is a publishable key, which is public by design. Email is the obvious join key and the wrong one, because providers let people change it and institutions let two people share a local part; a unique `(provider, subject)` pair is the only stable identifier, which is also why the binding script refuses any value containing `@`. Removing dev-login from the protected environments at registration time rather than in the handler is the difference between "hidden button" and "no anonymous path to create an account or grant `platform_admin`": a 404 route cannot be probed, and the handler's own 503 stays as the second lock. The PostgreSQL decision is a dialect problem, not a URL problem — MySQL accepts integer literals as boolean defaults and `psycopg2` rejects them with `DatatypeMismatch`, and its DDL is transactional, so a replay that fails leaves nothing behind rather than half a schema; replaying `0001`–`0012` to "get" PostgreSQL would therefore be both broken and, once edited, a rewrite of applied history. A baseline revision is the documented Alembic answer and it keeps one head. Finally, Clerk's SDK owns browser session tokens *by design* and refreshes them without asking; copying one into `tokenStore` would create a second credential that goes stale while the real one works, and a stale credential is exactly how a staging UI ends up showing someone else's scope.

**Consequences.** `GET /api/v1/auth/config` gained a fifth mode: `authentication` is now `development | clerk | bearer_boundary | unconfigured` and the response carries `identity_provider` (`clerk | local | none`), so `frontend/src/api/types.ts` mirrors both and `pages/SignIn.tsx` renders Clerk's form — or an honest "this build has no publishable key" panel — instead of a DataDiet credential form in that mode. Nothing was removed: `dev-login` still answers outside protected environments, pasted-token sign-in still answers the bearer boundary, and every existing page, permission string and institution-scope rule behaves as before. Verification moved from one path to a matrix. `backend/tests/test_clerk_verification.py`, `test_jwks_client.py`, `test_clerk_identity.py`, `test_bind_clerk_identity.py` and `test_migration_preflight.py` cover the verifier, the cache and rotation limits, the `sub` → account mapping (including that an unbound subject gets no account and no privileges, that an email change does not create a second user, and that auto-provisioning never grants administration), the operator CLI's refusals and audit trail, and the dialect-aware preflight; `test_migrations_postgresql.py` runs a real PostgreSQL server through `pgserver` (skipping with a stated reason when it is absent) and proves the single head, that the MySQL history cannot be replayed on PostgreSQL, that the documented stamp-then-upgrade path reaches head, that `compare_metadata()` reports zero drift against the models, and that `0013` issues no operation when the bound dialect is not PostgreSQL — proven with a recording `op` stand-in because no disposable MySQL exists in this environment, not by applying it to a live MySQL server — and is forward-only on PostgreSQL. SQLite is explicitly *not* treated as evidence of PostgreSQL behaviour, and the MySQL migration suite remains in place, now expecting head `0014_external_identities`. On the frontend, `src/auth/ClerkAuth.test.tsx` and the Clerk cases in `src/pages/SignIn.test.tsx` assert that a Clerk session token is the bearer credential on every request with no local copy, that a stale development token is discarded and never sent, that profile and permissions come only from `/auth/me`, that a refused or unlinked identity is shown as the server's own refusal with no session, that sign-out ends the provider's browser session as well as the local one, and that protected routes stay behind the provider session. Because the API client now resolves its credential asynchronously, page tests that answer a request synchronously after render had to wait for the request first (`RiskAnalysis.test.tsx`); the assertions themselves are unchanged. The Vitest *worker* configuration is now part of `npm test` (`--pool=forks --poolOptions.forks.maxForks=4`): measured on the 507-test suite, that configuration passes reproducibly while the default pool fails a shifting set of 5–6 tests with `Test timed out in 5000ms` and 1-second `findBy` timeouts caused by one-fork-per-core oversubscription starving jsdom. No timeout was increased, no test skipped, no assertion weakened — the change is concurrency only, and `scripts/check.ps1` therefore now runs the same gate CI runs. Two claims stay explicitly unproven by test: no test in this repository has spoken to a real Clerk instance (the SDK is replaced by a controllable stand-in, so Clerk's hosted form and token minting are exercised by no automated test here), and nothing has been deployed to Render, so the staging runbook is documentation whose facts come from Render's own docs, not from an executed deploy. The residual risks are the ones this design accepts knowingly: a protected environment with `CLERK_ISSUER` unset falls back to the HS256 bearer boundary rather than failing, which is a configuration the operator must not ship; `0013` cannot be downgraded on PostgreSQL; and `external_identities` makes binding an operational dependency — a Clerk user with no binding sees `unknown_account` until an operator runs the script.

---

## ADR-0026 — Azure SQL free-tier demo with a Vercel frontend and local backend

**Decision.** The Vite build is hosted on Vercel
(`frontend/vercel.json`: Vite build, `dist` output, SPA rewrite to
`/index.html`) and the FastAPI service runs locally on this machine at
`127.0.0.1:8000`. An earlier Railway plan was superseded before any Railway
resource existed: hosting the backend locally removes Railway's dynamic-egress
problem and lets the Azure SQL firewall stay limited to one operator IP. A free,
account-less Cloudflare quick tunnel supplies the public HTTPS origin
`https://experimental-flows-mounts-investor.trycloudflare.com` that forwards to
that loopback service, so remote browsers are not handed their own
`localhost`. The frontend receives only the public
`VITE_API_BASE_URL=https://experimental-flows-mounts-investor.trycloudflare.com`;
the git-ignored root `.env` receives the secret `DATABASE_URL` and the exact
Vercel origin in `CORS_ORIGINS`. No `VITE_` variable carries a secret.

The database is Azure SQL Database's free serverless tier in Southeast Asia
(Central US was rejected by subscription policy), reached with
`mssql+pymssql://`. `pymssql` needs no system ODBC driver and negotiates Azure
SQL's required TLS itself; `encrypt`, `trust_server_certificate` and `open_ssl`
are **not** valid pymssql URL options. The working URL uses
`?tds_version=7.4&login_timeout=20`. An Azure SQL login of the form
`user@server` is written `user%40server`; Alembic's INI parser would treat the
bare `%` as interpolation, so `database/migrations/url_escape.py` doubles it
before Alembic reads the option.

A new revision `0015_mssql_baseline` creates the 0001..0012 schema on SQL Server
and is a no-op on MySQL and PostgreSQL. `0014_external_identities` runs before it
in the graph but is a no-op on `mssql`, because its `app_users` foreign key
cannot resolve until the baseline creates the table; the baseline therefore
creates `external_identities` too. A fresh SQL Server database is stamped at
`0012_audit_platform_admin_reset` and then upgraded to head; the MySQL-only
history is never replayed and applied history is never edited. SQL Server also
rejects `ON DELETE RESTRICT` and multiple cascade paths, so the baseline uses
`NO ACTION` where needed. The read-only migration preflight accepts `mssql` and
prints the stamp-then-upgrade entry path.

**Why.** The application models and services are already SQLAlchemy-generic;
the real blockers were the driver, the dialect gate and the missing baseline.
A dialect-gated baseline follows the precedent of `0013_postgresql_baseline`
without rewriting migrations already applied elsewhere, while the SPA rewrite
is required because `BrowserRouter` deep links would otherwise 404 on Vercel.
Keeping the backend local and the firewall narrow honours the repository's
safety rules: a free-tier demo is not worth an unapproved internet-facing
database. The account-less tunnel is the minimum change that lets a remote
browser reach the loopback service without a hosting service or a broad SQL
firewall rule; it is a demo convenience, not a security boundary or a durable
deployment.

**Consequences.** The Alembic head changes from `0014_external_identities` to
`0015_mssql_baseline`, so every expected-head test and operator document was
updated. MySQL treats both `0013` and `0015` as pending no-ops; PostgreSQL
treats `0015` as a pending no-op. The executed path created the free serverless
database, a single-IP firewall rule, applied the migration chain to head,
verified TLS (`encrypt_option = TRUE`), deployed the Vercel project
`datadiet-demo` at `https://datadiet-demo.vercel.app`, started the free tunnel,
and smoke tested the tunneled `/api/v1/health`, `/api/v1/health/ready`, CORS
preflight, and a fresh browser load of `/api/v1/auth/config`. The tunnel URL is
random and changes whenever `cloudflared` restarts; each new URL must be baked
into a Vercel redeploy because Vite fixes `VITE_API_BASE_URL` at build time.
Backend `CORS_ORIGINS` does not change on a tunnel restart: the browser origin
remains `https://datadiet-demo.vercel.app`. Serverless auto-pause makes the
first connection after idle time fail with `40613`; the operator retries, and
the runbook records this instead of hiding it. Only synthetic `SYNTH-`
fixtures may be used: a successful connection is not evidence of seeded rows or
of a real institutional integration. The tunnel is public and anyone with its
URL can call the development API, including `/api/v1/auth/dev-login`; stop it
after the demo. Authentication stays fail-closed in protected environments
until Clerk or a strong `AUTH_JWT_SECRET` is configured; the local
`development` dev-login is for this demo only. The full operator record is
`docs/vercel-local-azure-sql.md`.

## ADR-0027 — Fix SQL Server boolean filters and simplify the demo sign-in

**Decision.** Two changes close the demo's sign-in problem without changing
what authentication is or what any role may do. First, boolean filters in
`backend/app/core/auth.py` and `backend/app/api/routes/users.py` use
SQLAlchemy's `== true()` instead of `.is_(True)`. SQLAlchemy compiles the latter
to `IS 1` on SQL Server, which rejects it; the resulting 500 was reported to the
browser only as `TypeError: Failed to fetch`, because Starlette does not add
CORS headers to an unhandled server error. `backend/tests/test_mssql_boolean_filters.py`
compiles the affected queries against the `mssql` dialect and asserts that no
`IS 1` remains. Second, `frontend/src/pages/SignIn.tsx` presents the development
path as one card with two primary fields — email and role — plus an explicit
`Advanced options` disclosure for display name, institution id and platform
admin, and a link to the pasted-token path instead of a permanently visible
second form. The default email is a `SYNTH-` address. The four states reported
by `GET /api/v1/auth/config` remain honest and unchanged; no route, API schema,
role, permission, audit rule or data fixture was altered.

**Why.** The `ui-ux-pro-max` skill was installed locally at the user's request
and searched for this page. Its design-system recommendation was Minimalism /
Swiss Style with low variance and motion, spacious density and an enterprise
SaaS tone; its form guidance asked for clear submit feedback and announced
errors. Those fit the repository's existing `index.css` tokens, so the redesign
reused them instead of introducing a parallel theme. A skill search for
collapsible advanced settings found no database match, so the disclosure is a
general progressive-disclosure decision, not a claimed catalog rule. The
operator-facing controls are still available — they are not removed — but they
do not compete with the two fields needed for the demo. The backend fix was
required before any UI polish could help: a successful `/auth/config` response
followed by a failing `dev-login` was a real server error hidden by CORS, and a
prettier form would not have repaired it.

**Consequences.** A tunneled `POST /api/v1/auth/dev-login` now returns 200 with
the expected Vercel origin allow-header and a server-verified bearer token.
Sign-in tests cover clearing the default email, opening advanced fields and
switching to the token path; the full local gate passes (backend pytest 368
passed / 20 skipped, Vitest 509 passed, production build). The bundle was
redeployed to production as `dpl_9mnP5Z4E6DdyfEa6nAWxUZfi52YJ` and aliased to
`https://datadiet-demo.vercel.app`; a fresh hosted-browser load confirmed the
simplified page, a tunneled config response of 200 and no console errors. The
tunnel remains public and ephemeral, and the database still has no seeded
institutional rows.
Nothing here makes development sign-in valid in a protected environment, and
nothing here uploads real personal data or claims an unimplemented
integration.

---

## ADR-0028 — Move the demo API from a local tunnel to Render

**Decision.** The stable demo backend is a Render Free Web Service in the
Singapore region, built from the `render-demo` branch of `Abysrix/DataDiet`.
The service uses `rootDir: backend`, `pip install -r requirements.txt`,
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, and health path
`/api/v1/health`. `DATABASE_URL` and `AUTH_JWT_SECRET` are encrypted Render
Environment Secrets; `ENVIRONMENT=development` keeps the synthetic dev-login
route available while a real strong JWT secret signs tokens, and
`CORS_ORIGINS=https://datadiet-demo.vercel.app` keeps the browser boundary
exact. Azure SQL remains the only database. Render's shared outbound addresses
are added to the Azure SQL firewall as narrow named rules; `0.0.0.0/0` remains
forbidden. Vercel keeps the SPA and is rebuilt with
`VITE_API_BASE_URL=https://<render-service>.onrender.com` only after the Render
health, readiness, CORS, and dev-login checks pass.

**Why.** The Cloudflare quick tunnel proved the browser contract but its URL
changes on restart and depends on a loopback process on the operator's machine.
Render provides a stable public HTTPS origin, a repeatable build from the exact
committed source, and platform secret storage for the SQL connection and token
signing key. Singapore reduces latency to the existing Azure SQL `southeastasia`
database. The operator explicitly accepted the free plan's ~15-minute sleep and
~1-minute wake-up, so the decision does not spend Azure credits or require a
paid Render plan.

**Consequences.** The repository source had to be pushed before Render could
build it. The local `master` history is unrelated to the GitHub `main` history,
so the demo was pushed as a separate `render-demo` branch rather than force-
overwriting `main`. Migrations were already applied to Azure SQL before cutover
because the free Render plan has no shell or one-off jobs. Until the live
checks in `docs/render-azure-sql-demo.md` are completed, this ADR records a
decision and runbook, not a verified deployment. Nothing here makes development
sign-in valid in a protected environment or turns the demo into a production
system.

**Verification (2026-11-27).** Render rebuilt from commit `581b608` on
`render-demo`; Vercel aliased `dpl_C6S4bAhwoWdwUExxKNK742GRUUWd` to the public
SPA origin. Health, readiness, exact-origin CORS, viewer login, allow-listed
elevation and unlisted 403 all passed against the live service. The shipped JS
contains the Render URL and no tunnel URL; the hosted browser called only
Render. Section 9 of `docs/render-azure-sql-demo.md` is the evidence record.
The free-tier sleep trade-off and the synthetic-data boundary are unchanged.

---

## ADR-0029 — Allow-list privileged fields on the public dev-login

**Decision.** The development sign-in route stays public for the hosted demo,
but elevated request fields are no longer self-service. `platform_admin`,
`institution_id`, and any role other than `viewer` are honoured only when the
normalised request email appears in `AUTH_DEV_PRIVILEGED_EMAILS`, a comma-separated
or JSON-array setting of exact synthetic addresses. An unlisted caller can still
obtain a plain viewer token; an elevated request is refused with 403 before any
account, membership, or audit row is written. The wildcard is permitted only in
`ENVIRONMENT=test`, where the suite predates the setting, and is rejected at
startup in any deployed environment. The Render demo allow-lists
`SYNTH-demo@datadiet.local`, `SYNTH-admin@datadiet.local`, and
`SYNTH-reviewer@datadiet.local`.

**Why.** Moving the API to a public Render origin changed the threat model: CORS
restrains browsers, not direct HTTP callers. The existing handler let any
anonymous caller choose `platform_admin: true` and mint a platform-admin bearer
token, or grant themselves an institution role. That was an unauthenticated
privilege escalation and contradicted the repository's fail-closed authorization
rules. The operator explicitly approved an exact synthetic allow-list as the
smallest change that preserves the hosted sign-in demo.

**Consequences.** `Settings` gains a documented environment variable in
`.env.example`; `backend/tests/test_config_dev_privileged_emails.py` covers its
parsing and the deployed-wildcard refusal; `backend/tests/test_auth.py` covers
refusal before writes and the allow-listed success path. The instruction that
named the admin email is now part of the runbook rather than a hidden UI trick.
This is demo hardening, not production authentication: protected environments
still do not register the route, and bearer tokens still live in client storage.

**Verification (2026-11-27).** After Render rebuilt from the hardened commit,
an unlisted `SYNTH-attacker@datadiet.local` request with `platform_admin: true`
received 403, while `SYNTH-admin@datadiet.local` received an elevated token
through the same public route. This closes the observed escalation without
changing the viewer path. The next production iteration replaces this route
with local email/password accounts.

---

## ADR-0030 — Remove the synthetic demo surface from the user-facing product

**Decision.** The demo API router, schemas, service, tests, frontend demo client,
demo-only types, `DemoNotice`, shared demo fixtures, and the `DEMO_DATA_ENABLED`
setting are removed. No user-facing route, UI copy, default field, or API
envelope may expose `SYNTH-` data. `GET /api/v1/health` and
`GET /api/v1/health/ready` remain real probes; Dashboard and Risk Analysis show
honest empty states when no database records exist. Synthetic identifiers stay
permitted in backend and frontend tests only. The dead `PlaceholderPage` and
deprecated `lib/labels` compatibility shim were removed in the same cleanup.

**Why.** The approved V1 objective is a hosted app usable with real,
user-entered governance metadata. A public demo surface with synthetic payloads
contradicts the "never fabricate an integration" and "never claim an untested
capability" rules, and it made empty hosted screens look populated without
proof that Azure SQL held any rows.

**Consequences.** Browser tests that depended on demo payloads were rewritten;
`backend/tests/test_no_demo_routes.py` guards that every former demo path is
404. Historical Clerk/Azure/Cloudflare documents remain as superseded evidence,
but stale operational guidance was corrected. No production data, real
institutional system, or personal data was introduced by this cleanup.

**Verification (2026-11-27).** `scripts/check.ps1` passed end to end: backend
Ruff clean, operator-script Ruff clean, 375 backend tests passed / 20 skipped,
frontend typecheck clean, 500 Vitest tests passed, and the production build
succeeded. The focused no-demo-route suite passed 5/5, and the sign-in suite
passed 17/17 after the blank-email default was covered. The change was pushed as commit `51e105e` on `render-demo`: Render rebuilt it
as `dep-dc49rcmi0phs739il3e0`, and Vercel promoted it to production as
`dpl_2T9QDAscKX8fCHspVdeWa8YQLYDC`, then rebuilt as
`dpl_FtWVsAbniGwEcc59iY4RbXmfqzDc` for the corrected frontend API setting. A
fresh browser check at `https://data-diet.vercel.app` showed `/auth/config`
called on the Render origin, an exact CORS allow-origin for the new frontend
domain, and no demo/synthetic/tunnel strings in the shipped bundle.

---

## ADR-0031 — Platform owner oversight with private per-account workspaces

**Decision.** `iamadmin@gmail.com` is the seeded platform owner of the whole
DataDiet project. The owner can see and manage all accounts and workspaces.
Every other open self-registration still creates its own private workspace and
its own admin membership/role rows; those workspaces remain isolated from one
another and are not merged into a single shared workspace. The server assigns
roles and ownership from the registration transaction and ignores all
client-supplied role, institution, membership, and platform-admin fields. The
owner password is chosen by the operator, stored only as a salted hash or
supplied at runtime as a secret, and never committed.

**Why.** The operator needs one account from which the hosted project and its
tenants can be demonstrated to a teacher, while still needing to show that a
new signup creates a private workspace with database-backed roles. This
supersedes only the earlier "never a platform administrator" assumption in
`spec/capability-map.md`; it does not relax tenant isolation, validation, or
the prohibition on real institutional/personal data.

**Consequences.** The `identity` module must implement seeded owner bootstrap,
email/password signup, signin, signout, change-password, hashed credential
storage, and rate-limit controls. The `workspace` module must persist one
workspace and one admin membership per signup, plus owner oversight with tests
that prove cross-tenant writes remain refused. Dev-login is removed from the
hosted flow before the demo, and the chosen owner password is delivered to the
operator out of band after implementation.

**Verification.** Pending: full gate plus live Render/Vercel smoke tests for
owner oversight, separate signup workspaces, and no anonymous privileged
paths.

---

## ADR-0032 — Time-boxed showcase prototype with clearly labeled sample data

**Status.** Accepted, temporary. Supersedes ADR-0030 only for the hosted
showcase build described below; ADR-0030 remains in force for every other
build.

**Amendment (2026-11-27, operator request).** The global prototype banner
described below is no longer rendered on any hosted page. The `/showcase` guide
remains available by direct URL, and seeded rows remain labeled
`[SHOWCASE SAMPLE]` in Azure SQL. The in-app labeling mitigation is therefore
retired; hosted verification must not claim a banner.

**Date.** 2026-11-27

**Context.** The operator needs a complete, presentable prototype today to show
what DataDiet can do, while the separate-workspace and local-identity modules
are explicitly deferred. The current hosted build has no user-facing demo data:
ADR-0030 removed the synthetic demo surface, and Dashboard/Risk show honest
empty states. The operator was asked directly and chose a clearly labeled
sample dataset on the current hosted app rather than live-entered data or
empty states alone.

**Decision.** Add a time-boxed `SHOWCASE_MODE` to the hosted prototype:

- Backend `SHOWCASE_MODE=true` and frontend `VITE_SHOWCASE_MODE=true` are the
  only switches that expose the prototype surface. Both default to false.
- A reviewed operator script seeds one dedicated showcase account/workspace
  with fictional records through the existing ORM and database. Every seeded
  record is visibly labeled as showcase sample data; no real institutional
  name, real personal data, or invented external integration is used.
- All reads and writes still go through the real API, real authentication, and
  Azure SQL. No endpoint may return a fabricated success state or simulated
  connector result.
- The UI originally showed a persistent prototype banner. By operator request
  on 2026-11-27 that banner was removed; no hosted page now renders it. The
  `/showcase` guide remains available by direct URL.
- The mode is for today's presentation only. Teardown is a human-approved
  operator action: disable both flags, redeploy, and remove the showcase rows
  through a reviewed script. No automatic deletion or bulk disposal is part of
  the application.

**Alternatives considered.**

- *Live-entered data only.* Fully compliant and best for production, but too
  slow to populate every feature before today's showcase.
- *Empty states only.* Honest, but does not demonstrate the analytical and
  governance workflows the audience needs to see.
- *Restore the old `/api/v1/demo/*` surface.* Rejected: it looked like a real
  integration, blurred the line between sample and production data, and was
  removed by ADR-0030 for that reason.

**Consequences.** The hosted prototype shows fictional data whose rows are
labeled `[SHOWCASE SAMPLE]` in Azure SQL and documented here, but it no longer
carries an unmissable in-app label. Tests must prove that the sample surface is absent when the
flags are off. The frontend bundle will contain the word `SHOWCASE` only as a
prototype label, never as a hidden data source. This ADR does not authorize
real institutional systems, real personal data, or untested capability claims;
those rules remain absolute. The showcase build must not be treated as the
production-ready multi-tenant release.

**Verification (local, 2026-11-27).** `scripts/check.ps1` passed end to end:
backend and operator-script Ruff clean, pytest 395 passed / 20 skipped, frontend
typecheck clean, Vitest 553 passed across 37 files, and the production build
succeeded. Focused tests cover both flag defaults and their gating
(`test_config_showcase.py`, `src/showcase.test.ts`), the guide copy, the seed's guards and idempotence
(`test_seed_showcase.py`), the new Dashboard and Risk read APIs, and the real
Users / Assets / Sources UI contracts. Every score shown comes from
`app.services.risk.compute_risk` under `documented-risk-v1` (ADR-0005). No
`SYNTH-` identifier, sample label or fixture is exposed when either flag is off;
the seed is the only writer of fictional rows and uses `DATABASE_URL` plus a
sanitized target print. **Hosted verification (2026-11-27).** The changes were
pushed to `render-demo`, both hosted flags were set, and the Azure SQL seed
created 6 rows and then 0 on rerun. Production build
`dpl_6zZxQ6YE5bHDw1cncZqZU6q88GLD` from commit `2c495d7` is aliased to
`https://data-diet.vercel.app`; a live browser pass found no global banner,
dashboard counts read from Azure SQL, viewer `auth/me` scoped to institution
`1`, and no console error, localhost or tunnel request. The admin directory
initially exposed four pre-existing non-showcase accounts (IDs 1, 3, 4 and 6);
after the operator explicitly approved irreversible removal of exactly those
rows, a one-off reviewed transaction deleted them and recorded an audit event.
No delete command was added to the application, and the directory now contains
only synthetic accounts. The exact deployment, page sweep, approval and firewall
evidence is in `docs/render-azure-sql-demo.md`.

---

## ADR-0033 — Dashboard groups one API snapshot by decision need

**Status.** Accepted.

**Amendment (2026-11-27, operator design override).** The operator granted a
design override with one constraint: not too much information. The controls
band, sensitivity and recommendation bars, and the full scan-job row described
below are no longer rendered on the dashboard. The page now keeps one posture
band, one decision cue, and two distributions; scan coverage remains a single
footer line. The fields still come from the same summary response, but they are
not a dashboard promise. No endpoint, permission or domain rule changed.

**Date.** 2026-11-27

**Context.** The dashboard rendered eight equal KPI tiles followed by five equal
cards. That grid gave volume, risk, governance and scan activity the same visual
weight, pushed the work awaiting a human decision below a wall of tiles, and used
a spinner where content-shaped feedback would preserve the page's rhythm. The
project already has a semantic token system (`index.css`) and shared primitives;
no new dependency or data source is warranted.

**Decision.** Keep one `GET /api/v1/dashboard/summary` request as the only data
source and reorganise its presentation:

- a primary posture band holds inventory volume, work under review, stored
  high/critical risk and scan coverage; a compact controls band holds policies,
  holds, assessments and decisions;
- inventory mix (lifecycle, sensitivity) and review signals (risk bands,
  recommendations) are separate cards with sequential `h2`/`h3` headings;
- scan jobs keep their own full-width row; the existing refresh, empty, error,
  permission and signed-out states remain;
- the data loading state is a labelled skeleton (`role="status"`, `aria-busy`)
  instead of a spinner, and no figure is invented or additionally derived beyond
  the existing documented high/critical band sum.

**Consequences.** The page still makes no browser-side claim about data it did
not receive, and every number continues to trace to the real API. The layout
uses only existing semantic tokens and primitives, so it inherits the project's
contrast, focus and reduced-motion rules. A visual change to this page requires
its tests to be updated; the redesign is local until an operator deploys a new
frontend build.

**Verification.** `src/pages/Dashboard.test.tsx` covers the scoped request, the
permission and signed-out gates, the labelled skeleton, the new grouping, the
API-only figures, the explicit empty state and the retryable error state. The
full `scripts/check.ps1` gate is recorded in the commit that introduced this ADR.

---

## ADR-0034 — Data-driven WebGL panel with an accessible fallback

**Status.** Accepted.

**Date.** 2026-11-27

**Context.** The operator asked for the Three.js skill guidance to be used
alongside the dashboard redesign. The hosted skill page was unreachable (HTTP
429 / Vercel checkpoint), so the local `ui-ux-pro-max` Three.js dataset was used:
canvas `role="img"` and `aria-label`, container-aware resize with camera aspect
updates, `setAnimationLoop` only, pause when hidden or offscreen, and explicit
GPU disposal. The dashboard must not become decorative: the visualisation has
to explain a real API distribution and stay readable without a GPU.

**Decision.** Add `three` as a code-split dependency and render the risk-band
counts as four 3D columns in a small panel:

- every column height is derived from `risk_bands` in the existing summary
  response; no count or score is invented in the browser;
- the canvas is labelled with the exact counts and has a visible semantic-colour
  legend; if WebGL2 is unavailable or the import fails, the same counts render
  through the existing `BarList` with an explicit fallback note;
- motion is a single one-shot reveal, not an idle spin. `prefers-reduced-motion`
  draws the final state immediately; the loop pauses on tab hide or offscreen;
- `ResizeObserver` sizes the renderer and updates `camera.aspect`; geometry and
  materials are shared, and all GPU resources plus the renderer are disposed on
  unmount;
- there is no raycasting, texture loading, orbit control or extra API request.

**Consequences.** The dashboard gains a small, purpose-built visual without
changing the data contract. Automated jsdom tests cover the fallback path and
the data labels but not rendered pixels; a browser check is still required
before claiming the WebGL appearance is verified. Colour values are read from
the existing CSS tokens, with mirrored fallbacks for tests and pre-style load.

**Verification.** `src/components/Distribution3D.test.tsx` covers both no-context
and throws-on-context fallback paths. `src/pages/Dashboard.test.tsx` asserts the
risk panel receives the API scope and that the counts remain visible through
the fallback. `scripts/check.ps1` must pass after any change to this panel.
