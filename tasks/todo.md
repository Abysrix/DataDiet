# Showcase Prototype Tasks

Plan: `tasks/plan.md`. Source decision: `docs/decisions.md` ADR-0032.

## Phase 1: Guardrails and seed foundation

- [x] Task 1: Backend showcase flag and `.env.example` wiring
  - Acceptance: `SHOWCASE_MODE` defaults false and is parsed from flat env strings; `.env.example` documents it; config tests cover default/on/off.
  - Verification: `..\scripts\check.ps1` and focused config tests.
  - Files: `backend/app/core/config.py`, `.env.example`, `backend/tests/test_config_showcase.py`.

- [x] Task 2: Persistent showcase banner and guide route
  - Acceptance: banner appears on every protected page when `VITE_SHOWCASE_MODE=true`, is absent otherwise, and links to a route explaining the prototype and its limits.
  - Verification: frontend tests for banner on/off and guide content; typecheck.
  - Files: `frontend/src/components/ShowcaseBanner.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/pages/ShowcaseGuide.tsx`, `frontend/src/App.tsx`, `frontend/src/components/nav.ts`, tests.

- [x] Task 3: Idempotent Azure SQL showcase seed script
  - Acceptance: script uses `DATABASE_URL`, requires an actor and `--confirm-showcase-write`, labels all rows as fictional showcase samples, and can be rerun without duplicates.
  - Verification: script unit tests on SQLite; ruff.
  - Files: `scripts/seed_showcase.py`, `backend/tests/test_seed_showcase.py`, `docs/render-azure-sql-demo.md`.

## Checkpoint: Guardrails
- [x] Focused tests pass; banner absent when flag off; seed guard refuses unconfirmed writes.

## Phase 2: Complete the real feature surface

- [x] Task 4: Database-backed Dashboard summary
  - Acceptance: new API returns real counts derived from Azure SQL; Dashboard renders those values with loading/error/empty states and no synthetic numbers.
  - Verification: backend service/route tests and frontend page test.
  - Files: backend route/schema/service, `frontend/src/api/`, `frontend/src/pages/Dashboard.tsx`, tests.

- [x] Task 5: Risk assessment API and page
  - Acceptance: risk service data is exposed through a protected read endpoint and rendered with score bands, indicators, sorting and honest empty/error states.
  - Verification: backend tests and frontend page test.
  - Files: `backend/app/api/routes/risk.py`, schema, router, `frontend/src/api/risk.ts`, `frontend/src/api/types.ts`, `frontend/src/pages/RiskAnalysis.tsx`, tests.

- [x] Task 6: User directory management UI
  - Acceptance: page lists real users and memberships from `/users`, shows current profile, and supports create/update through existing endpoints with error handling.
  - Verification: frontend test mocking the real API contract.
  - Files: `frontend/src/api/users.ts`, `frontend/src/pages/UserManagement.tsx`, tests.

- [x] Task 7: Asset create/edit UI
  - Acceptance: inventory can create and edit assets through `POST /assets` and `PATCH /assets/{id}`; validation, loading, empty and error states are covered.
  - Verification: frontend tests and typecheck.
  - Files: `frontend/src/api/assets.ts`, `frontend/src/pages/AssetEditor.tsx`, `frontend/src/pages/DataInventory.tsx`, tests.

- [x] Task 8: Sources and scan-jobs UI
  - Acceptance: page lists real sources/scan jobs and can validate, run, retry and inspect results/errors via the existing connector API; no institutional connector is claimed.
  - Verification: frontend tests and typecheck.
  - Files: `frontend/src/api/connectors.ts`, `frontend/src/pages/Sources.tsx`, nav, route, tests.

- [x] Task 9: Showcase guide narrative and not-implemented states
  - Acceptance: guide links the end-to-end demonstration flow and plainly labels archive execution, retrieval fulfilment, report export, signup/passwords and tenant isolation as not implemented in this prototype.
  - Verification: frontend test for required labels; manual browser review pending hosted deployment.
  - Files: `frontend/src/pages/ShowcaseGuide.tsx`, stub pages, tests.

## Checkpoint: Feature surface
- [x] All functional nav entries load real API data; stubs are honest; full gate passes.

## Phase 3: Seed completeness and hosted verification

- [x] Task 10: Complete seed dataset
  - Acceptance: seed contains fictional institution/user/membership, assets, active policy/version, hold, assessment, decision, classification results, risk assessments, source/scan rows and audit events; every list page has data.
  - Verification: seed tests assert each required table receives rows; live API list calls pending hosted seed.
  - Files: `scripts/seed_showcase.py`, `backend/tests/test_seed_showcase.py`.

- [x] Task 11: Documentation and status updates
  - Acceptance: ADR-0032 verification filled in; architecture status table, README, and hosted runbook match the deployed prototype; teardown procedure documented without automated deletion.
  - Verification: docs review; ruff/typecheck unaffected.
  - Files: `docs/decisions.md`, `docs/architecture.md`, `README.md`, `docs/render-azure-sql-demo.md`.

- [ ] Task 12: Deploy and smoke test
  - Acceptance: commit pushed to `render-demo`; Render/Vercel flags configured; seed run against Azure SQL; hosted browser pass proves banner, data and no fabricated integrations.
  - Verification: full gate from deployed commit, live health/readiness, API list calls, browser screenshots/network trace.
  - Files: deployment environment only.

## Checkpoint: Showcase ready
- [ ] Hosted banner visible on every page; data comes from Azure SQL via API; gate passes.

## Gate result (local, before hosted deployment)

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1` passed:
backend Ruff and operator-script Ruff clean, pytest 395 passed / 20 skipped,
frontend typecheck clean, Vitest 557 passed (38 files), and the production build
succeeded.
