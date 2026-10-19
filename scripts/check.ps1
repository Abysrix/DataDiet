# Runs every automated check in the repository.
#   .\scripts\check.ps1
# Exits non-zero on the first failure.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Virtual environment not found at $python. See docs/setup.md to create it."
}

Write-Host "== Backend lint (ruff) ==" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "backend")
& $python -m ruff check .

Write-Host "== Backend tests (pytest) ==" -ForegroundColor Cyan
& $python -m pytest
Pop-Location

Write-Host "== Frontend type check (tsc) ==" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "frontend")
npm run typecheck

Write-Host "== Frontend tests (vitest) ==" -ForegroundColor Cyan
npm test

Write-Host "== Frontend production build ==" -ForegroundColor Cyan
npm run build
Pop-Location

Write-Host "All checks passed." -ForegroundColor Green
