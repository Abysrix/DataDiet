# DataDiet Setup (Windows PowerShell)

All commands are PowerShell and assume the repository is at
`C:\Users\yadav\Desktop\DataDiet`. Adjust the path if you cloned it elsewhere.

## Prerequisites

| Tool | Version used for Phase 1 | Notes |
| --- | --- | --- |
| Node.js | 24.13.1 | includes npm 11.8 |
| Python | 3.14.1 | any 3.11+ should work |
| Git | 2.55 | |
| Docker Desktop | optional | needed only for MySQL and the Nginx preview |

Docker is **not** required to run the frontend, the backend health endpoint, or
the synthetic demo endpoints that power the Phase 1 UI.

## 1. Configure environment

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet
Copy-Item .env.example .env
```

`.env` is git-ignored. Never commit real credentials. The default development
values match `infra/docker-compose.dev.yml`.

## 2. Backend (FastAPI)

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet

# Create the virtual environment (once)
python -m venv .venv

# Install dependencies
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt

# Run the API (from the backend directory so app.* imports resolve)
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API root: http://127.0.0.1:8000/
- Swagger UI (API documentation): http://127.0.0.1:8000/docs
- Liveness: http://127.0.0.1:8000/api/v1/health
- Readiness (database probe): http://127.0.0.1:8000/api/v1/health/ready

`/api/v1/health/ready` returns HTTP 503 with `"status": "degraded"` until MySQL
is running — that is expected behaviour, not a crash.

## 3. Frontend (React + Vite)

In a second PowerShell window:

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet\frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to
`http://localhost:8000`, so leave `VITE_API_BASE_URL` empty in `.env`.

## 4. Database (MySQL, optional in Phase 1)

Requires Docker Desktop:

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet
docker compose -f infra/docker-compose.dev.yml up -d mysql
docker compose -f infra/docker-compose.dev.yml ps   # wait for "healthy"

# Apply migrations
Set-Location backend
..\.venv\Scripts\alembic.exe upgrade head
..\.venv\Scripts\alembic.exe current
```

Expected result: `0010_classification_downgrade_safety` (head). Without Docker,
skip this section — the application still runs and reports the database as
unreachable.

Supported rollback boundary: **`0005_source_connectors`** — do not
`alembic downgrade` below it (ADR-0016 explains the safe failure mode and the
repair procedure if you do).

## 5. Signing in (Phase 7)

Every endpoint except `/api/v1/health` and `/api/v1/auth/config` requires a
signed bearer token (ADR-0014). How you get one depends on the deployment:

- **Development (default):** open http://localhost:5173 and use the
  *Development sign-in* form on `/signin`. It calls `POST /api/v1/auth/dev-login`,
  which creates/reuses a synthetic local account and issues a real HS256 token
  through the same verification path as every other token. This is explicitly
  **not** production authentication and is hard-disabled when
  `ENVIRONMENT=production` (503 `sign_in_unavailable:`).
- **Bearer boundary:** paste an externally issued token (HS256, your
  `AUTH_JWT_ISSUER` / `AUTH_JWT_AUDIENCE` claims, a `sub` or `email` matching a
  local account). The sign-in page shows the exact contract from
  `/api/v1/auth/config`.
- **Unconfigured:** the page says authentication is not configured instead of
  showing a form. In production this is the state until an operator sets a real
  `AUTH_JWT_SECRET` — every protected endpoint then returns 503
  `auth_not_configured:` (fail closed by design).

Create the first platform administrator offline (there is no HTTP bootstrap):

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet\backend
..\.venv\Scripts\python.exe ..\scripts\bootstrap_admin.py --email admin@example.org --institution-id 1 --role admin
```

Authorization (roles, institution scope) always comes from the local user
directory, never from token claims. Sign-out is client-side: the token is
discarded from `localStorage` (bearer tokens are stateless; there is no logout
endpoint).

## 6. Run the checks

Backend:

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet\backend
..\.venv\Scripts\python.exe -m pytest              # 163 tests; 15 skipped by default
..\.venv\Scripts\python.exe -m ruff check .         # lint

# The 14 skipped MySQL migration tests run when a disposable MySQL is available:
# $env:MIGRATION_TEST_DB_URL = "mysql+pymysql://root:@127.0.0.1:3307/datadiet_mig"
# ..\.venv\Scripts\python.exe -m pytest tests/test_migrations_mysql.py     # 14 tests
```

Frontend:

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet\frontend
npm run typecheck     # tsc strict, no emit
npm test              # vitest run, 80 tests
npm run build         # production bundle into dist/
```

Everything from the repository root:

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet
.\scripts\check.ps1
```

## 7. Creating a new migration

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet\backend
# 1. Edit app\db\models.py
# 2. Autogenerate a revision against the running dev database
..\.venv\Scripts\alembic.exe revision --autogenerate -m "add example column"
# 3. Review the generated file in ..\database\migrations\versions\
..\.venv\Scripts\alembic.exe upgrade head
```

Never hand-edit production tables; models change first, then migrations.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/api/v1/health/ready` returns 503 | MySQL is not running: start Docker Compose or ignore it — only the database-dependent features care |
| Frontend shows "Could not reach the DataDiet API" | Start the backend on port 8000, or set `VITE_API_BASE_URL` in `.env` |
| `ModuleNotFoundError: app` | Run uvicorn/pytest **from `backend/`**, not the repository root |
| `alembic: command not found` | Use the full path `..\.venv\Scripts\alembic.exe` |
| Port 5173/8000 already in use | Stop the other process or pass `--port` / `server.port` overrides |
| `Access denied for user 'datadiet'` | Recreate the container volume: `docker compose -f infra/docker-compose.dev.yml down -v` then start again |
| App redirects to `/signin` | You are signed out (or have no token). Use the development sign-in form in development; in production this means auth is configured but your token is missing/expired |
| Sign-in page says "not configured" | Expected in production until an operator sets `AUTH_JWT_SECRET` (see `.env.example`) — endpoints fail closed with 503 `auth_not_configured:` by design |
| A page action is missing although the API works | The action is permission-gated for your role (ADR-0014); sign in with an account whose role has the permission |
