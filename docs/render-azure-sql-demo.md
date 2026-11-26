# Render + Azure SQL demo runbook

This runbook replaces the temporary Cloudflare tunnel in
`docs/vercel-local-azure-sql.md` with a stable Render Free Web Service. The SPA
stays on Vercel; the API moves to Render; the database remains the existing
Azure SQL Database `datadiet_demo`. No Azure credits are spent, no real
institutional data is uploaded, and no destructive lifecycle action is enabled.

> Status: verified live on 2026-11-27 after ADR-0028/0029, then re-verified after
> the ADR-0030/0031 cutover. Sections 9 and 10 record the exact commits,
> deployment IDs and live checks. Section 11 adds the temporary ADR-0032
> showcase configuration; that hosted configuration and its live smoke test are
> **pending**, while the local gate for the source state has passed. Render's
> free plan still sleeps after ~15 minutes of inactivity and takes about a
> minute to wake; the operator has explicitly accepted that trade-off.

## 1. Source and build

Use the GitHub branch `render-demo` from `Abysrix/DataDiet` (commit `51e105e`,
which removes the synthetic demo surface and records ADR-0030/0031). The repository
also has an unrelated `main` history; do not switch the service to `main`
without reconciling that history first.

| Render setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime | Python |
| Region | Singapore (closest to Azure SQL `southeastasia`) |
| Plan | Free |
| Branch | `render-demo` |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/v1/health` |

Do **not** install `backend/requirements-dev.txt` on the service: it contains
test-only tooling. `pymssql>=2.4` is already in `requirements.txt`.

## 2. Environment variables

Set these in Render's dashboard. `DATABASE_URL` and `AUTH_JWT_SECRET` must be
encrypted Environment Secrets, never committed values and never `VITE_*`.

| Key | Value | Secret? |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | no |
| `DATABASE_URL` | `mssql+pymssql://datadiet_admin%40datadiet-demo-sql-sa5416:<password>@datadiet-demo-sql-sa5416.database.windows.net:1433/datadiet_demo?tds_version=7.4&login_timeout=20` | **yes** |
| `AUTH_JWT_SECRET` | a unique `python -c "import secrets; print(secrets.token_urlsafe(48))"` value, at least 32 characters | **yes** |
| `CORS_ORIGINS` | `https://data-diet.vercel.app` | no |
| `AUTH_DEV_PROVIDER_ENABLED` | `true` (explicit; also the development default) | no |
| `AUTH_DEV_PRIVILEGED_EMAILS` | `SYNTH-demo@datadiet.local,SYNTH-admin@datadiet.local,SYNTH-reviewer@datadiet.local` | no |

Why `development` rather than `staging`/`production`: the demo intentionally uses
the development sign-in path with a real strong signing secret. Protected
environments disable that route entirely and fail closed without Clerk. This is
a documented demo configuration, not a claim of production readiness.

Because the Render URL is public, `AUTH_DEV_PRIVILEGED_EMAILS` is mandatory. A
plain viewer sign-in stays open for any `SYNTH-` email, but `platform_admin`,
`institution_id`, and non-viewer roles are honoured only for the three exact
addresses above (ADR-0029). Never set the wildcard on a deployed service.

`%40` is required because Azure SQL's login is `datadiet_admin@SERVER`. The
username must not be percent-encoded by hand anywhere else. `tds_version` and
`login_timeout` are valid pymssql URL options; `encrypt` and
`trust_server_certificate` are not.

## 3. Azure SQL firewall

Render's free plan uses shared outbound IPs. Do not create `0.0.0.0/0`.

1. Open the Render service, then **Connect → Outbound** (or the current
   dashboard location for outbound IP addresses) and record every listed IPv4
   address/CIDR.
2. In Azure, add one narrow firewall rule per individual address, or per CIDR
   when Render publishes a range:

   ```powershell
   az sql server firewall-rule create `
     --resource-group datadiet-demo-rg `
     --server datadiet-demo-sql-sa5416 `
     --name RenderOutbound01 `
     --start-ip-address <START_IP> `
     --end-ip-address <END_IP>
   ```

3. Keep the existing `LocalDemo` rule for local operations. Never delete it
   during the demo.
4. If Render later rotates an outbound address, update only these named rules.

## 4. Migrations and startup

The free plan has no shell and no one-off jobs. Migrations were already applied
locally to head `0015_mssql_baseline`; do not try to run Alembic on Render.
After a rebuild or a new database, verify from a machine that still has narrow
firewall access:

```powershell
Set-Location backend
..\.venv\Scripts\alembic.exe current
..\scripts\check.ps1  # from the workspace root for the full gate
```

The API does not run migrations at startup. Alembic remains a reviewed,
human-gated operation (ADR-0018).

## 5. Verification before the Vercel cutover

Let the service build, then run these from an operator machine:

```powershell
$api = 'https://<render-service>.onrender.com'
Invoke-RestMethod "$api/api/v1/health"
Invoke-WebRequest "$api/api/v1/health" -Method Head | Select-Object StatusCode
Invoke-RestMethod "$api/api/v1/health/ready"

# Exact Vercel origin must be reflected, not '*'.
Invoke-WebRequest "$api/api/v1/auth/config" `
  -Method Options `
  -Headers @{
    'Origin' = 'https://data-diet.vercel.app'
    'Access-Control-Request-Method' = 'GET'
  } | Select-Object -ExpandProperty Headers

# Real development sign-in; use only synthetic SYNTH- identities.
Invoke-RestMethod "$api/api/v1/auth/dev-login" -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"SYNTH-demo@datadiet.local","display_name":"Demo Viewer","role":"viewer"}'
```

Expected: health 200; HEAD health 200 with no response body; readiness 200 once
Azure SQL resumes from auto-pause; preflight returns
`access-control-allow-origin: https://data-diet.vercel.app` and its allowed
methods include `HEAD`; dev-login 200 with a bearer token. Any 500 with no CORS
header is a server fault, not a frontend problem.

Also verify the public-endpoint guard (ADR-0029). The first request must be
refused; only the allow-listed address in the second request may be elevated:

```powershell
Invoke-WebRequest "$api/api/v1/auth/dev-login" -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"SYNTH-attacker@datadiet.local","platform_admin":true}' |
  Select-Object -ExpandProperty StatusCode  # 403

Invoke-RestMethod "$api/api/v1/auth/dev-login" -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"SYNTH-admin@datadiet.local","platform_admin":true}' |
  Select-Object user
```

## 6. Vercel cutover

Set the Vercel project environment variable, then redeploy:

```text
VITE_API_BASE_URL=https://datadiet-demo-api.onrender.com
```

Only `VITE_*` reaches the browser bundle; no database or signing secret is sent
to Vercel. Verify in a fresh browser session at
`https://data-diet.vercel.app`:

- `GET /api/v1/auth/config` hits the Render origin and returns 200;
- sign-in with the default `SYNTH-` email succeeds;
- permission-refused data is shown as a clear server message, not a blank page;
- no console errors and no `localhost` or tunnel URL in network requests.

Stop the Cloudflare tunnel only after all of the above pass.

## 7. Rollback

1. Restore `VITE_API_BASE_URL` in Vercel to the previous tunnel URL and redeploy.
2. Keep the Render service running for diagnosis; do not delete it.
3. If the failure is authentication, compare Render's `ENVIRONMENT`,
   `AUTH_JWT_SECRET`, and `CORS_ORIGINS` values first.
4. If the failure is database reachability, check `/health/ready` and the named
   Azure SQL firewall rules before changing application code.

## 8. Honest boundaries

- The app is a synthetic demo. No real institutional systems or personal data.
- Archive, restore, move, and disposal remain unimplemented; the UI says so.
- Free-tier sleep is an accepted operator-managed condition, not an app bug.
- Do not set `0.0.0.0/0`, do not publish the SQL password, and do not mark this
  deployment production-ready without the work in
  `docs/production-readiness.md`.

## 9. Verified cutover (2026-11-27)

The pushed source is `Abysrix/DataDiet:render-demo` commit `581b608`
(`7017faf` security hardening plus `581b608` UI redesign). Render rebuilt the
service from that branch and Vercel aliased deployment
`dpl_C6S4bAhwoWdwUExxKNK742GRUUWd` to `https://datadiet-demo.vercel.app`.

Live checks after both deployments:

- `GET /api/v1/health` → 200; `GET /api/v1/health/ready` → database reachable.
- CORS preflight from `https://datadiet-demo.vercel.app` reflects that exact
  origin; no wildcard.
- Viewer dev-login returns a bearer token; allow-listed
  `SYNTH-admin@datadiet.local` may request `platform_admin: true`; unlisted
  `SYNTH-attacker@datadiet.local` receives 403.
- The production bundle's JavaScript contains
  `https://datadiet-demo-api.onrender.com` and no `trycloudflare` string. A
  fresh hosted browser session loaded `/signin`, called `/auth/config` and
  `/auth/me` on the Render origin, and made no tunnel or localhost request.

The Cloudflare quick tunnel is no longer used by the hosted app. It was left
running only as a fallback until the checks above passed; stop it before
claiming the old path is gone. This cutover does not by itself satisfy the
production-readiness work recorded in `docs/production-readiness.md`.

## 10. Synthetic removal and new frontend domain (2026-11-27)

Source commit `51e105e11d871f4263f5916619dba650964e4fbf` from `render-demo`
removed the demo router, client, notice, fixtures, types and stale copy. Render
rebuilt the service as deploy `dep-dc49rcmi0phs739il3e0` after `CORS_ORIGINS`
was changed to `https://data-diet.vercel.app`, and the rebuild succeeded from
the same commit. A browser request from the new frontend origin to
`GET https://datadiet-demo-api.onrender.com/api/v1/health` returned 200 with
`access-control-allow-origin: https://data-diet.vercel.app`; the request header
was `origin: https://data-diet.vercel.app`. No former `/api/v1/demo/*` path is
registered.

Vercel project `datadiet-demo` was connected to `Abysrix/DataDiet`, its root
directory was corrected to `frontend`, and a deploy hook on `render-demo`
produced a successful preview deployment. It was promoted to production as
`dpl_2T9QDAscKX8fCHspVdeWa8YQLYDC`, then rebuilt as
`dpl_FtWVsAbniGwEcc59iY4RbXmfqzDc` after the frontend API setting was fixed.
The stale value `VITE_API_BASE_URL=https://data-diet.vercel.app/` had made the
SPA call itself; the correct value is the Render origin
`https://datadiet-demo-api.onrender.com` (no `/api/v1` suffix because the API
clients append that path). The current production deployment is aliased to
`https://data-diet.vercel.app` and a fresh browser load of `/signin` called
`GET https://datadiet-demo-api.onrender.com/api/v1/auth/config` with HTTP 200.
The shipped JavaScript contains no `/api/v1/demo`, `SYNTH-`, `trycloudflare`,
or `datadiet-demo.vercel.app` string.

This is still a development-authentication deployment: `/auth/config` reports
the development sign-in path and `AUTH_DEV_PROVIDER_ENABLED=true` on Render.
Local email/password identity, private workspaces, platform-owner oversight and
removal of dev-login are the next work items; no production-readiness claim is
made here.

## 11. Temporary showcase prototype (ADR-0032)

This section is the operator checklist for today's clearly labeled prototype.
Nothing below is a production configuration. Both showcase flags default to
`false`, so a build without them still hides all sample data and the banner.

### 11.1 Flags

| Platform | Variable | Showcase value | Effect |
| --- | --- | --- | --- |
| Render (backend) | `SHOWCASE_MODE` | `true` | Permits the reviewed seed script to write; exposes the backend showcase surface |
| Vercel (frontend) | `VITE_SHOWCASE_MODE` | `true` | Shows the persistent banner and links the `/showcase` guide |

A Render environment-variable change rebuilds the service. Vercel must be
redeployed separately after its variable is set. Keep `CORS_ORIGINS` exactly
`https://data-diet.vercel.app` and `VITE_API_BASE_URL` exactly
`https://datadiet-demo-api.onrender.com` (no `/api/v1` suffix). Do **not** put a
database URL, signing key or other secret in a `VITE_*` variable.

### 11.2 Seed Azure SQL

The seed is the only writer of fictional showcase rows. It uses the same
`DATABASE_URL` as the API, prints only a sanitized target, requires an actor and
an explicit confirmation, refuses when the backend flag is off, and is
idempotent. From `backend/` on an operator machine with narrow firewall access:

```powershell
$env:SHOWCASE_MODE = "true"
..\.venv\Scripts\python.exe ..\scripts\seed_showcase.py `
  --actor "ops:your-name" --confirm-showcase-write
```

Expected output names the database target (host and database only, no
credentials) and a `Showcase seed complete (created N rows; institution #M)`
line. Every row is prefixed `[SHOWCASE SAMPLE]`; reruns create zero rows. The
seed runs the real synthetic connector through `scan.create_job` /
`scan.run_scan` and relabels imported rows. It writes audit events through the
application's audit service. It never deletes, archives or disposes anything.

Record the printed institution id `M` for the sign-in step below. The seeded
`SYNTH-showcase-*` accounts are fictional; they contain no real identity or
personal data.

### 11.3 Hosted verification

1. Wait for the Render wake-up, then check `GET /api/v1/health` (200),
   `HEAD /api/v1/health` (bodyless 200) and `GET /api/v1/health/ready` (database
   reachable).
2. Confirm the CORS preflight still reflects only
   `https://data-diet.vercel.app`.
3. Sign in at `https://data-diet.vercel.app`:
   - viewer path: `SYNTH-showcase-viewer@datadiet.local`, role `viewer`, no
     elevated fields;
   - administrative path: the already allow-listed
     `SYNTH-admin@datadiet.local`, role `admin`, with `institution_id = M` in
     **Advanced options**. The role/institution fields are honoured only for the
     three allow-listed synthetic emails (ADR-0029), so do not use a wildcard.
4. In a fresh browser session verify the persistent prototype banner on every
   protected page, then open `/showcase`. The guide must list archive execution,
   retrieval fulfilment, report export, password signup and private workspaces
   as **not implemented**.
5. In the browser network panel every data request must go to the Render origin
   (`/api/v1/...`). There must be no localhost or tunnel request, no demo
   endpoint, no fabricated success toast, and no connector claiming to contact
   an institutional system.
6. Check the seeded rows through the real API: dashboard counts, risk bands and
   rule descriptors, source/scan-job history, inventory assets, classifications,
   policies and holds, review queue, and the user directory. Empty or error
   states must be honest; do not call a page verified if it only shows a cached
   or mocked value.
7. Keep screenshots and the network trace with the deployment record.

### 11.4 Human-gated teardown

The application contains no deletion, bulk-disposal or teardown command. To end
the showcase:

1. Remove `SHOWCASE_MODE` from Render and `VITE_SHOWCASE_MODE` from Vercel, then
   redeploy both. The banner and guide disappear and the seed script refuses to
   write again.
2. Obtain explicit human approval naming the `SHOWCASE-DEMO` institution and the
   exact rows in scope. Only then, in a reviewed database session, remove the
   showcase institution and its dependent fictional rows; never run a DELETE
   from the UI, a browser console or an unreviewed script.
3. Record who approved, who executed, the row counts before/after, and the
   resulting Alembic revision (migrations themselves are never changed by
   teardown).

Until steps 1–3 are executed and recorded, this remains a live prototype, not a
production system. Local email/password signup, private workspaces and
platform-owner oversight are still unimplemented.
