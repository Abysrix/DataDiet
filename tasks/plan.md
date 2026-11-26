# Implementation Plan: Showcase Prototype (2026-11-27)

Source spec: `docs/decisions.md` ADR-0032. Deferred production work remains in
`spec/capability-map.md`.

## Overview

Build a time-boxed, clearly labeled prototype on the current hosted app. All
displayed records are fictional sample rows written to Azure SQL by a reviewed
operator script and fetched through the real FastAPI endpoints. No browser
fixtures, fake endpoints, simulated connectors, or invented success states are
allowed. Capabilities that are not implemented stay explicitly labeled as such.

## Architecture Decisions

- **Two independent flags.** Backend `SHOWCASE_MODE` controls the seed/API
  surface; frontend `VITE_SHOWCASE_MODE` controls the persistent banner and
  showcase guide. Both default to false, so normal builds retain ADR-0030's
  no-user-facing-sample-data rule.
- **Azure SQL is the only data source.** `scripts/seed_showcase.py` opens the
  same `DATABASE_URL` as the API, writes through SQLAlchemy models, and is
  idempotent. The browser only ever reads through `/api/v1/*`.
- **Real features only.** The prototype connects existing DB-backed screens and
  adds thin API/UI slices for Dashboard, Risk, Users, Assets and Sources — all
  backed by real services/tables. Archive, retrieval, report export and local
  passwords remain visible but marked not implemented.
- **Human-gated teardown.** The app never deletes or bulk-disposes data. A
  documented operator procedure disables the flags and removes showcase rows.

## Task List

### Phase 1: Guardrails and seed foundation

- [x] Task 1: Backend showcase flag and `.env.example` wiring
- [x] Task 2: Persistent showcase banner and guide route in the frontend
- [x] Task 3: Idempotent Azure SQL showcase seed script with labeled fictional rows

### Checkpoint: Guardrails
- [x] Focused backend/frontend tests pass
- [x] Banner absent when `VITE_SHOWCASE_MODE` is off
- [x] Seed script refuses to run without an explicit operator actor

### Phase 2: Complete the real feature surface

- [x] Task 4: Database-backed Dashboard summary endpoint and page
- [x] Task 5: Risk assessment API and Risk Analysis page
- [x] Task 6: User directory management UI on the existing `/users` API
- [x] Task 7: Asset create/edit UI on the existing `/assets` API
- [x] Task 8: Sources and scan-jobs UI on the existing connector API
- [x] Task 9: Showcase guide narrative and explicit not-implemented states

### Checkpoint: Feature surface
- [x] Every functional nav entry loads real API data
- [x] Every stub states that the capability is not implemented
- [x] Full `scripts/check.ps1` gate passes (395 backend passed / 20 skipped, 557 frontend passed)

### Phase 3: Seed completeness and hosted verification

- [x] Task 10: Expand seed to policies, holds, assessments, decisions, classification, risk, sources, scans and audit events
- [x] Task 11: Update ADR-0032 verification, architecture status table, README and runbook
- [ ] Task 12: Commit, push, configure Render/Vercel flags, seed Azure SQL and browser smoke test

### Checkpoint: Showcase ready
- [ ] Hosted banner visible on every page
- [ ] Hosted data traces back to Azure SQL through the API
- [ ] Full gate passes from the exact deployed commit

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Sample data leaks into normal builds | High | Server/frontend flags default off; tests assert absence; ADR-0032 remains temporary |
| Public prototype mistaken for production | High | Persistent banner, guide page, docs and ADR all state prototype-only |
| Seed script writes to wrong database | High | Uses `DATABASE_URL` only, prints sanitized target, requires `--confirm-showcase-write` and an actor |
| Dashboard/Risk queries become slow on Azure SQL | Medium | Aggregate with bounded queries; reuse existing indexed tables; Paginate lists |
| Render free-tier sleep delays first load | Medium | Document ~1 minute wake; smoke test after warm-up |

## Open Questions

- None. The operator chose clearly labeled sample data on the current hosted app
  and confirmed Azure SQL as the only data source.
