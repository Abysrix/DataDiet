# Runs every automated check in the repository.
#   .\scripts\check.ps1
# Exits non-zero on the first failure.
#
# Native command failures (ruff, pytest, npm) do not throw on their own — in
# Windows PowerShell the ErrorActionPreference does not cover exit codes — so
# every step is followed by an explicit exit-code check.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Virtual environment not found at $python. See docs/setup.md to create it."
}

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "$Step failed with exit code $LASTEXITCODE." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "== Backend lint (ruff) ==" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "backend")
& $python -m ruff check .
Assert-LastExitCode "Backend lint (ruff)"

Write-Host "== Backend tests (pytest) ==" -ForegroundColor Cyan
& $python -m pytest
Assert-LastExitCode "Backend tests (pytest)"
Pop-Location

Write-Host "== Frontend type check (tsc) ==" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "frontend")
npm run typecheck
Assert-LastExitCode "Frontend type check (tsc)"

Write-Host "== Frontend tests (vitest) ==" -ForegroundColor Cyan
npm test
Assert-LastExitCode "Frontend tests (vitest)"

Write-Host "== Frontend production build ==" -ForegroundColor Cyan
npm run build
Assert-LastExitCode "Frontend production build"
Pop-Location

Write-Host "All checks passed." -ForegroundColor Green
