# Demo runbook: Vercel frontend + local backend + Azure SQL Database

**Status: historical, superseded by `docs/render-azure-sql-demo.md`.** The
Cloudflare tunnel is stopped and dev-login is being replaced by local accounts.

**Executed for the local demo on 2026-11-27.** The Azure SQL server,
free serverless database, narrow firewall rule, Alembic migration, Vercel
deployment, local backend CORS configuration and a free Cloudflare quick tunnel
are in place. Re-check the live values below before trusting them; cloud
resources, auto-pause and the account-less tunnel URL can change between demos.

## 1. Topology and safety gates

```text
browser (any machine) ──► https://datadiet-demo.vercel.app  (Vite SPA)
                                      │
                                      │ API calls to VITE_API_BASE_URL
                                      ▼
        https://experimental-flows-mounts-investor.trycloudflare.com
                                      │  Cloudflare quick tunnel (HTTPS)
                                      ▼
                         http://127.0.0.1:8000  (local uvicorn)
                                      │
                                      │ SQLAlchemy mssql+pymssql
                                      ▼
        datadiet_demo on datadiet-demo-sql-sa5416.database.windows.net
```

1. **Free-only.** Azure SQL uses the free serverless limit in
   `southeastasia`. No Azure for Students credit was intentionally spent.
   Central US was rejected by subscription policy (`RequestDisallowedByAzure`),
   so Southeast Asia was used instead.
2. **No broad firewall rule.** Only this machine's public IP is allowed. No
   `0.0.0.0/0` rule was created. If the public IP changes, update the existing
   narrow rule; never widen it without explicit approval.
3. **No fabricated data.** This historical tunnel runbook no longer serves
   in-memory fixtures; records are created by signed-in users through the real
   API. `/api/v1/health/ready` is the only claim that Azure SQL was reached.
4. **No fabricated integration.** Every page must show its real loading, empty
   and error states. `GET /api/v1/health/ready` is the only claim that the
   backend reached the database.
5. **No secrets in the frontend.** `DATABASE_URL` and the SQL admin password
   stay in the git-ignored root `.env`. Only `VITE_API_BASE_URL` was given to
   Vercel; it is public by design.
6. **The tunnel is a demo convenience, not a security boundary.** A free,
   account-less Cloudflare quick tunnel exposes the local backend over HTTPS at
   a random `*.trycloudflare.com` origin. Anyone with that URL can call the
   development API, including dev-login, so use only synthetic data and stop the
   tunnel after the demo. It has no uptime guarantee and gets a new URL on every
   restart.

## 2. Live resources

| Item | Value |
| --- | --- |
| Resource group | `datadiet-demo-rg` |
| SQL Server | `datadiet-demo-sql-sa5416` |
| FQDN | `datadiet-demo-sql-sa5416.database.windows.net` |
| Database | `datadiet_demo` |
| Region | `southeastasia` |
| SKU | `GP_S_Gen5` (serverless, `useFreeLimit=true`, `AutoPause`) |
| Admin login | `datadiet_admin` (password only in local secret files) |
| Firewall rule | `LocalDemo`, single IP `149.50.211.131` |
| Alembic head | `0015_mssql_baseline` |
| Vercel project | `datadiet-demo` |
| Vercel URL | `https://datadiet-demo.vercel.app` |
| Vercel build env | `VITE_API_BASE_URL=https://experimental-flows-mounts-investor.trycloudflare.com` |
| Tunnel | Cloudflare quick tunnel, account-less, HTTPS, random URL |
| Local backend | `uvicorn app.main:app --host 127.0.0.1 --port 8000` |
| Backend CORS | `CORS_ORIGINS=https://datadiet-demo.vercel.app` |

The Vercel project has **Deployment Protection (Vercel Authentication)** on.
The owner can view it; other viewers may need to be invited or use a bypass.
That setting is a Vercel account decision and is not part of the application
code.

## 3. Azure SQL creation (already done; shown for recovery)

Run with an authenticated Azure CLI and an operator-supplied password:

```powershell
$resourceGroup = "datadiet-demo-rg"
$server        = "datadiet-demo-sql-sa5416"
$database      = "datadiet_demo"
$location      = "southeastasia"

az group create --name $resourceGroup --location $location

az sql server create `
  --name $server `
  --resource-group $resourceGroup `
  --location $location `
  --admin-user "datadiet_admin" `
  --admin-password $env:DATADIET_SQL_ADMIN_PASSWORD `
  --enable-public-network true

az sql db create `
  --name $database `
  --server $server `
  --resource-group $resourceGroup `
  --edition GeneralPurpose `
  --family Gen5 `
  --capacity 2 `
  --compute-model Serverless `
  --use-free-limit true `
  --free-limit-exhaustion-behavior AutoPause `
  --backup-storage-redundancy Local `
  --yes

# Confirm and update this to the CURRENT public IP; do not widen the range.
$ip = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json').ip
az sql server firewall-rule create `
  --name LocalDemo `
  --server $server `
  --resource-group $resourceGroup `
  --start-ip-address $ip `
  --end-ip-address $ip
```

Verify the shape:

```powershell
az sql db show --name $database --server $server --resource-group $resourceGroup `
  --query '{status:status,sku:sku.name,useFreeLimit:useFreeLimit,freeLimitExhaustionBehavior:freeLimitExhaustionBehavior}' -o json
```

Expected `sku` is `GP_S_Gen5`, `useFreeLimit` is `true`, and
`freeLimitExhaustionBehavior` is `AutoPause`. A `Resuming` status is normal
after idle time.

## 4. Database URL and migrations

Azure SQL usernames are `user@server`; the `@` must be percent-encoded as `%40`
in the SQLAlchemy URL. Alembic's INI parser would otherwise treat `%` as
interpolation, so `database/migrations/url_escape.py` doubles it before Alembic
reads the option.

pymssql 2.4 negotiates Azure SQL's required TLS itself. It does **not** accept
`encrypt`, `trust_server_certificate` or `open_ssl` as URL options. The valid
options used here are `tds_version` and `login_timeout`:

```text
DATABASE_URL=mssql+pymssql://datadiet_admin%40SERVER:PASSWORD@SERVER.database.windows.net:1433/datadiet_demo?tds_version=7.4&login_timeout=20
```

The password is generated locally and stored only in the git-ignored root
`.env`. Never print it, paste it into a ticket or put it in a `VITE_` variable.

From `backend/`, the fresh-SQL Server path is:

```powershell
..\ .venv\Scripts\python.exe ..\scripts\migration_preflight.py
..\ .venv\Scripts\python.exe -m alembic stamp 0012_audit_platform_admin_reset
..\ .venv\Scripts\python.exe -m alembic upgrade head
..\ .venv\Scripts\python.exe -m alembic current
```

Expected: head `0015_mssql_baseline`, preflight reports no pending migration.
Never run `alembic upgrade 0001` on SQL Server: revisions `0001`..`0012`
contain MySQL-only DDL. `0015` is forward-only; do not downgrade it.

SQL Server-specific details pinned in `0015_mssql_baseline`:

- `0014_external_identities` is a no-op on `mssql` because `app_users` does not
  exist until the baseline runs; the baseline creates `external_identities`.
- `ON DELETE RESTRICT` becomes `NO ACTION`.
- Self/version references that would create a second cascade path use
  `NO ACTION`; `retention_decisions.asset_id` does not cascade directly because
  `inventory_records -> retention_assessments -> retention_decisions` already
  provides that path.

Live verification performed:

```text
SELECT 1                                  -> 1
SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id = @@SPID
                                          -> TRUE
alembic current                           -> 0015_mssql_baseline (head)
```

## 5. Backend (this machine)

The root `.env` is git-ignored and currently has:

```text
ENVIRONMENT=development
DATABASE_URL=<the Azure SQL URL above>
CORS_ORIGINS=https://datadiet-demo.vercel.app
```

`development` is deliberate: it keeps `POST /api/v1/auth/dev-login` available
for synthetic accounts. In staging/production the route is absent and Clerk or
a strong `AUTH_JWT_SECRET` is required. Do not move this local backend to a
public interface.

Start it from `backend/`:

```powershell
& '..\.venv\Scripts\python.exe' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Smoke test:

```text
GET http://127.0.0.1:8000/api/v1/health       -> 200 {"status":"ok",...}
GET http://127.0.0.1:8000/api/v1/health/ready -> 200 with database reachable:true
```

A CORS preflight from the Vercel origin must return
`access-control-allow-origin: https://datadiet-demo.vercel.app`.

Because the database is serverless with auto-pause, the first connection after
idle time can return HTTP 503 with SQL error `40613` ("not currently
available") and `status: "Resuming"`. Retry after Azure SQL finishes resuming;
this is not an application defect. Keep the local backend running during the
demo to avoid repeated cold starts.

## 6. Frontend (Vercel)

The project was created from `frontend/` with root directory `frontend`.
`frontend/vercel.json` declares the Vite build, `dist` output and a
`/(.*) -> /index.html` rewrite for `BrowserRouter` deep links.

Build-time variable set on the deployment:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://experimental-flows-mounts-investor.trycloudflare.com` |

No other secret was sent to Vercel. Vite bakes this variable into the bundle,
so changing it requires a rebuild/redeploy. `/api/v1/health` is used for the
header's health indicator; an offline backend is shown honestly rather than
faking data.

Redeploy command with the current tunnel URL:

```powershell
npx --yes vercel@latest deploy --prod --yes --project datadiet-demo `
  --build-env VITE_API_BASE_URL=https://experimental-flows-mounts-investor.trycloudflare.com
```

## 7. Cloudflare quick tunnel (remote viewers)

The free, account-less `cloudflared` quick tunnel gives the HTTPS origin that a
Vercel page needs to call a local backend without mixed-content blocking. The
binary is kept outside the repository at
`$env:TEMP\opencode\cloudflared.exe`; no tunnel credential or config is
committed.

Start it from this machine while uvicorn is running:

```powershell
$tunnelExe = Join-Path $env:TEMP 'opencode\cloudflared.exe'
& $tunnelExe tunnel --no-autoupdate --url http://127.0.0.1:8000
```

Read the `https://<random-name>.trycloudflare.com` line from the tunnel output.
The current URL is
`https://experimental-flows-mounts-investor.trycloudflare.com`. Verify it
directly before the demo:

```text
GET https://<tunnel-url>/api/v1/health       -> 200
GET https://<tunnel-url>/api/v1/health/ready -> 200 with database reachable:true
```

The tunnel URL changes every time the process restarts. When it changes,
redeploy Vercel with the new `--build-env VITE_API_BASE_URL=...` value; the
backend's `CORS_ORIGINS` does **not** change because the browser origin is still
`https://datadiet-demo.vercel.app`.

Stop the tunnel after the demo. It is public: anyone with the URL can reach the
development API and its dev-login route.

### If the page says "Could not reach the DataDiet API"

That message wraps any failed browser `fetch`; it does not by itself prove the
backend is down. Check in the viewer's browser:

1. Open `https://<tunnel-url>/api/v1/health`. If it returns JSON, the tunnel and
   backend are up; hard-reload the Vercel page to clear a stale error state.
2. If the health URL itself fails, the tunnel process likely stopped. Restart
   it and read the new URL; if it changed, redeploy Vercel with that new
   `VITE_API_BASE_URL`.
3. If the health URL works on the operator machine but not on the viewer's
   network, that network is blocking `trycloudflare.com`; use another network or
   a named Cloudflare tunnel with a stable hostname.
4. A CORS failure also appears as `TypeError: Failed to fetch`. The browser
   console will name it; the expected `access-control-allow-origin` is
   `https://datadiet-demo.vercel.app`, not the tunnel URL.
5. If `GET /auth/config` succeeds but `POST /auth/dev-login` fails, do not stop
   at the browser message: read the backend log and send a direct tunneled POST.
   An unhandled 500 has no CORS headers, so the browser can hide a real server
   error behind `TypeError: Failed to fetch`. On SQL Server this happened when
   SQLAlchemy compiled `.is_(True)` as `IS 1`; the corrected filters use
   `== true()` and are guarded by `backend/tests/test_mssql_boolean_filters.py`.

## 8. Demo checklist

1. Start the local backend and leave it running.
2. Start the Cloudflare quick tunnel from section 7 and leave it running.
3. Wake Azure SQL if needed; confirm `/health/ready` returns
   `database.reachable: true`.
4. If the tunnel URL changed, redeploy Vercel with the new
   `VITE_API_BASE_URL`; Vite bakes it into the bundle at build time.
5. If the sign-in page or any frontend source changed locally, redeploy Vercel
   first; the hosted URL otherwise keeps serving the previous bundle. Vite bakes
   the current `VITE_API_BASE_URL` into that bundle at build time.
6. Open `https://datadiet-demo.vercel.app` from any browser that can reach the
   two public origins. Remote viewers no longer need a local backend.
7. Refresh a deep route such as `/governance/assets/1`; the SPA rewrite should
   serve `index.html` and the API calls should target the `trycloudflare.com`
   tunnel, not `localhost`.
8. This historical runbook's dev-login step is superseded by local
   email/password sign-up on the current Render/Vercel deployment. Do not use
   this tunnel path for account creation.
9. After the demo, stop the tunnel first, then the backend. The tunnel is
   public even though the backend itself still binds only `127.0.0.1`.

A live browser smoke test of the production URL rendered the development
sign-in page, made `GET https://experimental-flows-mounts-investor.trycloudflare.com/api/v1/auth/config`
with status 200 through the tunnel, and reported no console errors. After the
SQL Server boolean fix, a tunneled `POST .../auth/dev-login` also returned 200
with `access-control-allow-origin: https://datadiet-demo.vercel.app` and a real
bearer token. That proves the deployed SPA reaches the local backend over HTTPS;
it does not prove any database-backed page has rows. The simplified sign-in
page passed typecheck, Vitest and the production build and was redeployed to
production as `dpl_9mnP5Z4E6DdyfEa6nAWxUZfi52YJ`, aliased to
`https://datadiet-demo.vercel.app`; a fresh hosted-browser load confirmed the
simplified page, a tunneled config response of 200 and no console errors.
Deployment protection remains enabled.

## 9. What this does not prove

- No rows have been seeded into Azure SQL; the synthetic demo endpoints are
  in-memory and enveloped, not database evidence.
- No real Clerk instance, institutional identity provider or personal data is
  involved.
- No second human device/network was used; verification was a fresh browser
  load of the two public URLs, not a separate attendee's machine.
- The account-less tunnel has no uptime guarantee, and anyone with its URL can
  call the development API, including dev-login. It is not a security boundary.
- Restore drills, least-privilege DB roles, 2FA on the Vercel account and the
  remaining items in `docs/production-readiness.md` are still open.
- Auto-pause can make the first request fail with `40613`; that is expected and
  must be retried, not hidden.
