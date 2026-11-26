# Capability Map: DataDiet production iteration V1

Status: approved 2026-11-27. Operator approved one private workspace per
self-registered account, V1 change-password without email verification or
forgot-password, and all five listed governance-quality defects in scope.

## Objective

Make the hosted app usable by a normal user with a real account and real,
user-entered governance metadata, while keeping the current free hosting tiers
and the repository's safety rules. Replace the public synthetic sign-in path on
the deployed service, make the empty data views genuinely writable, and fix the
product defects found in the first feature audit.

## Assumptions

1. "User-entered data" means non-personal governance metadata (assets,
   policies, holds, assessments, decisions) created by signed-in users. No real
   institutional systems are connected and no real personal data is uploaded.
2. Open self-registration creates a private institution workspace owned by the
   new account. That account is an admin **only** inside its own workspace and
   is never a platform administrator. The server ignores client-supplied role,
   institution, membership and platform-admin fields on signup.
3. Free tiers stay. Render may sleep and Azure SQL may auto-pause; V1 does not
   add paid monitoring, backups or always-on capacity.
4. There is no mail provider in V1. Email verification and self-service
   forgot-password are deferred, not faked. V1 offers sign-up, sign-in,
   sign-out, and change-password while signed in.
5. The existing HS256 bearer token, local user directory, role matrix and
   institution scope checks remain authoritative. `/auth/config` gains a
   `local` mode and the public dev-login route can be disabled by environment
   without changing `ENVIRONMENT`.
6. Archive, restore, move and disposal remain unimplemented and explicitly
   labelled. No automatic deletion or bulk disposal is added.

## Modules

| Module id | Responsibility | Depends on | V1 boundary |
| --- | --- | --- | --- |
| `identity` | Local credentials: sign-up, sign-in, sign-out, change password, hashed password storage, validation, abuse/rate-limit controls, honest error codes, and frontend auth UI. | — | No email verification, no forgot-password flow, no role/admin fields accepted from the browser. |
| `workspace` | Server-side private institution and admin membership created atomically with a new account; cross-tenant isolation preserved. | `identity` | One workspace per self-registered account in V1; no invitation or shared-membership UI. |
| `dynamic-data` | Real database-backed Dashboard/Risk summaries; asset create/edit UI backed by existing `/assets` endpoints; connect user-created assets to classification, retention policies, holds, assessments and decisions; remove synthetic fixtures from hosted views. | `workspace` | No file-content scanning, no external connectors, no lifecycle execution. |
| `governance-quality` | Fix the audited flaws: supersession-candidate failures reported as "no earlier decision", missing audit actors on policies/holds/assessments, silent classification-check errors, wrong decision count wording, and skeleton-plus-stale-data refetch states. | `dynamic-data` |Connector/source and full user-directory UIs remain deferred; honest "not implemented" pages stay. |
| `deployment-hardening` | Switch Render to local auth with dev-login off, update Vercel/API config if needed, verify live sign-up → data-entry → review flow, record ADRs and runbook evidence, keep free-tier caveats visible. | `identity`, `workspace`, `dynamic-data` | No paid-tier change, no claim of full production readiness while monitoring/backups remain deferred. |

## Build order

`identity` → `workspace` → `dynamic-data` → `governance-quality` → `deployment-hardening`

Each module gets its own Specify → Plan → Tasks → Implement cycle, with tests
written first and the full `scripts/check.ps1` gate passing before the next
module starts.

## Success criteria for V1

- A fresh browser user can sign up, land in a private workspace, create an
  asset, create/activate a policy, run classification and assessment, record a
  decision, and see those records after sign-out/sign-in.
- A second account cannot read or write the first account's records; attempts
  are refused with the existing 404 out-of-scope behaviour.
- Hosted Dashboard/Risk show real database-derived counts and empty states; no
  `synthetic_demo_data` envelope or `SYNTH-` default appears in the hosted flow.
- Public dev-login is absent/disabled on the deployed service; elevated fields
  are impossible to request from the browser.
- All six checks in `scripts/check.ps1` pass; live Render/Vercel smoke test is
  recorded in `docs/architecture.md` and a new ADR.

## Deferred to V2 (captured, not silently included)

- Email verification and self-service password reset (needs a mail provider).
- Source/connector provisioning UI and external system integration.
- Full user-directory and membership administration UI.
- Archive, retrieval fulfilment, report export/signing, and lifecycle actions.
- Paid tiers, always-on capacity, error reporting and backup automation.
- Clerk/OIDC federation and RS256/JWKS as a first-party sign-in option.

## Open questions for approval

1. Is one private workspace per self-registered account the right V1 model?
2. Is it acceptable to defer email verification and forgot-password to V2,
   with change-password included in V1?
3. Should the `governance-quality` module include all five listed defects, or
   only the two high-severity ones?
