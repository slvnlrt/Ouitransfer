#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Scans the codebase for deferred work markers, technical debt indicators,
    and incomplete implementation comments.

.DESCRIPTION
    Uses ripgrep to find TODO, FIXME, HACK, and other deferred-work patterns
    in source code files. Excludes test files, node_modules, and build artifacts.

    Results are grouped by category for easy triage.

.PARAMETER Path
    Root directory to scan. Defaults to the repository root.

.PARAMETER IncludeTests
    If set, includes test files in the scan results.

.EXAMPLE
    ./scripts/scan-deferred-work.ps1
    ./scripts/scan-deferred-work.ps1 -Path apps/server/src
    ./scripts/scan-deferred-work.ps1 -IncludeTests
#>

param(
    [string]$Path = ".",
    [switch]$IncludeTests
)

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = $Path }

# ── Resolve ripgrep binary ───────────────────────────────────────────────────

$rgCmd = Get-Command rg -ErrorAction SilentlyContinue
if ($rgCmd) {
    $rg = $rgCmd.Source
} else {
    # winget installs rg here but new shells may not have the updated PATH yet
    $rg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "rg.exe" -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
    if (-not $rg) {
        Write-Error "ripgrep (rg) not found. Install it with: winget install BurntSushi.ripgrep.MSVC"
        exit 1
    }
}

# ── Common rg flags ──────────────────────────────────────────────────────────

$rgBase = @(
    "--type", "ts"           # .ts and .tsx
    "--no-heading"
    "--line-number"
    "--color", "never"
    "--max-columns", "200"
    "--glob", "!node_modules/**"
    "--glob", "!dist/**"
    "--glob", "!.next/**"
    "--glob", "!build/**"
    "--glob", "!coverage/**"
    "--glob", "!*.d.ts"
    "--glob", "!generated/**"
    "--glob", "!prisma/generated/**"
)

if (-not $IncludeTests) {
    $rgBase += @(
        "--glob", "!**/__tests__/**"
        "--glob", "!**/*.test.ts"
        "--glob", "!**/*.test.tsx"
        "--glob", "!**/*.spec.ts"
        "--glob", "!**/*.spec.tsx"
        "--glob", "!**/test/**"
        "--glob", "!**/tests/**"
        "--glob", "!**/__mocks__/**"
        "--glob", "!**/fixtures/**"
    )
}

# ── Pattern categories ───────────────────────────────────────────────────────

$categories = [ordered]@{

    # --- Explicit markers ---
    "EXPLICIT: TODO/FIXME/HACK/XXX" = @(
        "--pcre2", "-e", "//\s*(TODO|FIXME|HACK|XXX)\b"
        "-e", "/\*\s*(TODO|FIXME|HACK|XXX)\b"
        "-e", "^\s*\*\s*(TODO|FIXME|HACK|XXX)\b"
    )

    "EXPLICIT: DEFERRED/REVISIT/WORKAROUND" = @(
        "--pcre2", "-e", "//\s*(DEFERRED|REVISIT|WORKAROUND)\b"
        "-e", "/\*\s*(DEFERRED|REVISIT|WORKAROUND)\b"
        "-e", "^\s*\*\s*(DEFERRED|REVISIT|WORKAROUND)\b"
    )

    "EXPLICIT: TEMP/TEMPORARY" = @(
        "--pcre2", "-e", "//\s*(TEMP|TEMPORARY)\b"
        "-e", "/\*\s*(TEMP|TEMPORARY)\b"
    )

    "EXPLICIT: REFACTOR/OPTIMIZE/DEPRECATED" = @(
        "--pcre2", "-e", "//\s*(REFACTOR|OPTIMIZE|DEPRECATED)\b"
        "-e", "/\*\s*(REFACTOR|OPTIMIZE|DEPRECATED)\b"
        "-e", "^\s*\*\s*(REFACTOR|OPTIMIZE|DEPRECATED)\b"
    )

    # --- Safety / security ---
    "SAFETY: NOCOMMIT/UNSAFE/INSECURE" = @(
        "--pcre2", "-e", "(NOCOMMIT|NO.COMMIT|UNSAFE|INSECURE)"
    )

    # --- Soft markers (in comments) ---
    "SOFT: for now / good enough / not ideal" = @(
        "--pcre2", "-e", "//.*\b(for now|good enough|not ideal)\b"
        "-e", "^\s*\*.*\b(for now|good enough|not ideal)\b"
    )

    "SOFT: trade-off / known limitation" = @(
        "--pcre2", "-e", "//.*\b(trade.?off|known limitation)\b"
        "-e", "^\s*\*.*\b(trade.?off|known limitation)\b"
    )

    "SOFT: placeholder / stub / not implemented / incomplete" = @(
        "--pcre2", "-e", "//.*\b(placeholder|stub|not implemented|incomplete)\b"
        "-e", "^\s*\*.*\b(placeholder|stub|not implemented|incomplete)\b"
    )

    "SOFT: hardcoded / magic number / magic value" = @(
        "--pcre2", "-e", "//.*\b(hard.?coded|magic number|magic value)\b"
        "-e", "^\s*\*.*\b(hard.?coded|magic number|magic value)\b"
    )

    "SOFT: later / eventually / consider / missing / skipped" = @(
        "--pcre2", "-e", "//.*\b(later|eventually|consider|missing|skipped)\b"
        "-e", "^\s*\*.*\b(later|eventually|consider|missing|skipped)\b"
    )

    "ATTENTION: NOTE: / WARNING:" = @(
        "--pcre2", "-e", "//\s*(NOTE|WARNING):"
        "-e", "^\s*\*\s*(NOTE|WARNING):"
    )
}

# ── Execution ────────────────────────────────────────────────────────────────

$totalMatches = 0

foreach ($category in $categories.Keys) {
    $patterns = $categories[$category]

    $results = & $rg @rgBase @patterns $Path 2>$null

    if ($results) {
        $lines = @($results)
        $count = $lines.Count
        $totalMatches += $count

        Write-Host ""
        Write-Host "━━━ $category ($count matches) ━━━" -ForegroundColor Cyan
        Write-Host ""
        foreach ($line in $lines) {
            Write-Host "  $line"
        }
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
Write-Host "  Total matches: $totalMatches" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
