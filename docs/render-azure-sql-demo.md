# Render + Azure SQL demo runbook

This runbook replaces the temporary Cloudflare tunnel in
`docs/vercel-local-azure-sql.md` with a stable Render Free Web Service. The SPA
stays on Vercel; the API moves to Render; the database remains the existing
Azure SQL Database `datadiet_demo`. No Azure credits are spent, no real
institutional data is uploaded, and no destructive lifecycle action is enabled.

> Status: prepared after ADR-0028. Service creation, firewall widening, and the
> Vercel cutover must be verified live before this document claims they are done.
> Render's free plan sleeps after ~15 minutes of inactivity and takes about a
> minute to wake; the operator has explicitly accepted that trade-off.

## 1. Source and build

Use the GitHub branch `render-demo` from `Abysrix/DataDiet` (commit `910035d` at
the time of writing). The repository also has an unrelated `main` history; do
not switch the service to `main` without reconciling that history first.

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
| `CORS_ORIGINS` | `https://datadiet-demo.vercel.app` | no |
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
Invoke-RestMethod "$api/api/v1/health/ready"

# Exact Vercel origin must be reflected, not '*'.
Invoke-WebRequest "$api/api/v1/auth/config" `
  -Method Options `
  -Headers @{
    'Origin' = 'https://datadiet-demo.vercel.app'
    'Access-Control-Request-Method' = 'GET'
  } | Select-Object -ExpandProperty Headers

# Real development sign-in; use only synthetic SYNTH- identities.
Invoke-RestMethod "$api/api/v1/auth/dev-login" -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"SYNTH-demo@datadiet.local","display_name":"Demo Viewer","role":"viewer"}'
```

Expected: health 200; readiness 200 once Azure SQL resumes from auto-pause;
preflight returns `access-control-allow-origin: https://datadiet-demo.vercel.app`;
dev-login 200 with a bearer token. Any 500 with no CORS header is a server
fault, not a frontend problem.

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
VITE_API_BASE_URL=https://<render-service>.onrender.com
```

Only `VITE_*` reaches the browser bundle; no database or signing secret is sent
to Vercel. Verify in a fresh browser session at
`https://datadiet-demo.vercel.app`:

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
