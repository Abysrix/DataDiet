# DataDiet

**Intelligent data lifecycle and privacy-management platform.** DataDiet
inventories institutional records, identifies duplicate candidates, assesses
sensitivity with explainable risk indicators, evaluates versioned retention
policies and holds, and prepares human-approved lifecycle actions — without
ever deleting data automatically.

> **Phase 1 status: foundation.** This repository contains a working, tested
> application skeleton. It does **not** scan, archive, retrieve, or delete
> anything, it has **no authentication**, and it connects to **no institutional
> system**. Every figure shown in the UI is explicitly labeled synthetic demo
> data. See `docs/architecture.md` for the capability-by-capability status.

## Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Frontend | React, TypeScript (strict), Tailwind CSS, Vite | React 19.3 · TS 5.9 · Tailwind 4.3 · Vite 6.4 |
| Backend | Python, FastAPI, Pydantic v2, SQLAlchemy 2 | FastAPI 0.143 · Pydantic 2.14 · SQLAlchemy 2.1 |
| Database | MySQL (Alembic migrations) | MySQL 8.4 |
| Web server | Nginx (future deployment config, `infra/nginx/`) | 1.27 |
| Tests | pytest + ruff · Vitest + Testing Library | pytest 9.1 · Vitest 3.2 |

## Repository layout

```
DataDiet/
├── frontend/   React + TypeScript + Tailwind (Vite)
├── backend/    FastAPI app (api / services / db layers) + tests
├── database/   Alembic migrations (schema authority) and docs
├── infra/      docker-compose.dev.yml + future Nginx configuration
├── docs/       architecture, setup, decision records
├── scripts/    check.ps1 (runs every automated check)
├── .env.example
└── AGENTS.md   instructions for AI/automation contributors
```

## Quick start (Windows PowerShell)

```powershell
Set-Location C:\Users\yadav\Desktop\DataDiet
Copy-Item .env.example .env

# --- Backend (terminal 1) ---
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
#   API:  http://127.0.0.1:8000/docs

# --- Frontend (terminal 2) ---
Set-Location C:\Users\yadav\Desktop\DataDiet\frontend
npm install
npm run dev
#   UI:   http://localhost:5173

# --- Database (optional, needs Docker Desktop) ---
Set-Location C:\Users\yadav\Desktop\DataDiet
docker compose -f infra/docker-compose.dev.yml up -d mysql
Set-Location backend
..\.venv\Scripts\alembic.exe upgrade head
```

Full instructions, troubleshooting, and migration workflow: `docs/setup.md`.

## What Phase 1 delivers

- Responsive institutional dashboard with sidebar navigation (Dashboard, Data
  Inventory, Risk Analysis, Retention Policies, Archive, Retrieval Requests,
  Reports, User Management) and mobile drawer.
- FastAPI application with health/readiness probes and Swagger documentation.
- MySQL development configuration, Alembic migration `0001_initial_schema`
  (ten tables covering inventory, risk, policies, holds, approvals, archives,
  retrieval, audit, and users), and validated environment settings.
- Typed frontend API client with loading, empty, and error states on every view.
- Synthetic sample data served through a `synthetic_demo_data`-labeled API.
- Automated tests: 16 backend (pytest) + 15 frontend (Vitest).

## Checks

```powershell
.\scripts\check.ps1          # everything
```

Individually: `backend`: `..\.venv\Scripts\python.exe -m pytest` and
`-m ruff check .`; `frontend`: `npm run typecheck`, `npm test`, `npm run build`.

## Safety principles (non-negotiable)

1. **No automatic deletion, ever.** Disposal requires documented policy
   evaluation and explicit human approval.
2. **No real personal data in development.** Synthetic fixtures only.
3. **No real institutional connections** until a connector is implemented,
   reviewed, and tested.
4. **No production database tables created by hand** — models change, then
   migrations.
5. **No credentials in the frontend.** Database URLs, API keys, and tokens are
   backend-only, supplied via environment variables.
6. **No capability claimed before it is implemented and tested.** Unbuilt
   features say so in the UI and in `docs/`.
7. **No arbitrary scoring.** Every risk point traces to a documented, tested
   rule (see `docs/decisions.md`, ADR-0005).

## Documentation

| Document | Contents |
| --- | --- |
| `docs/architecture.md` | Components, layering, schema, safety boundaries, phase map |
| `docs/setup.md` | Exact PowerShell setup, run, test, and migration commands |
| `docs/decisions.md` | Decision records, including the risk rule table |
| `database/README.md` | Migration workflow and development MySQL details |
| `infra/README.md` | Docker Compose and Nginx usage |

License: proprietary (placeholder — update for your institution).
