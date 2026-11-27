# DataDiet — project overview

DataDiet is an internal console for making defensible data-lifecycle and privacy
decisions about institutional records. It does not control records by itself: it
reads an inventory, explains sensitivity and risk, applies documented retention
rules and holds, and presents the next safe action to a human reviewer.

## The job it does

1. **Inventory.** Operators register data sources and scan jobs. The resulting
   assets are listed and scoped by institution; the app does not connect to real
   institutional systems.
2. **Assess.** Each asset can be classified and assessed for sensitivity,
   duplication candidates and risk. Risk points come only from the documented,
   tested rule table in `docs/decisions.md` (ADR-0005), so a number can always be
   explained.
3. **Constrain.** Versioned retention policies and active holds supply the
   rules and blockers that must be considered before any lifecycle decision.
4. **Decide.** A review queue gathers assets needing attention. Authorised
   reviewers record retain, archive, review, reject or similar decisions; the
   system records the decision and its supersession history.
5. **Observe.** Dashboard, risk analysis, inventory, source, user and audit
   screens show the stored state with explicit loading, empty and error states.
   Nothing is filled in by the browser.

## What it deliberately does not do

- No automatic archive, restore, move, delete or disposal. Every lifecycle
  action stays a human decision backed by policy evaluation.
- No real institutional connector and no real personal data in development.
  Hosted showcase rows are fictional and only exist when the two reviewable
  showcase flags are enabled.
- No password signup, identity sync, approval delegation, access-review export
  or account deletion. These are not implemented and the UI must say so.
- No production identity provider yet. Production fails closed without a valid
  signing secret; the remaining blockers are in
  `docs/production-readiness.md`.

## How it is built

- **Backend:** FastAPI with Pydantic v2 boundaries, service-layer business
  rules, and SQLAlchemy 2 models. HTTP lives in `app/api/routes`; no SQL is
  written outside `app/db`.
- **Database:** Alembic is the schema authority. Local development uses MySQL;
  the hosted prototype uses Azure SQL.
- **Frontend:** React 19 and strict TypeScript with Tailwind CSS design tokens.
  Pages call typed API clients; shared primitives provide consistent focus,
  status, loading and error treatment.
- **Dashboard:** one scoped summary request feeds a restrained posture band, a
  decision cue, a small risk-distribution WebGL panel and a lifecycle bar list.
  The WebGL panel has a labelled canvas and a bar fallback (ADR-0033/0034).
- **Verification:** `scripts/check.ps1` runs backend Ruff, operator-script Ruff,
  pytest, frontend typecheck, Vitest and a production build. The CI workflow
  mirrors those checks.

## Current status

This is a working, tested development and demonstration application, not a
production records system. The temporary hosted showcase is described in
`docs/render-azure-sql-demo.md`; architecture status is in
`docs/architecture.md`, and the reasoning behind significant choices is in
`docs/decisions.md`.
