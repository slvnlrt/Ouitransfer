#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Check off all findings in one or more 8.2 review files.

.DESCRIPTION
    Transforms finding headings from:
        ### C-1: Title
        #### I-2: Title
    to:
        ### ~~C-1~~ [x]: Title
        #### ~~I-2~~ [x]: Title

    Handles both ### and #### heading levels.
    Already-checked findings are left untouched (idempotent).

.PARAMETER Files
    One or more review markdown files to process. Supports wildcards.

.EXAMPLE
    # Check off a single file
    .\check-off-review.ps1 -Files 8.2-review-5-server-core.md

.EXAMPLE
    # Check off all pass-5 review files at once
    .\check-off-review.ps1 -Files 8.2-review-5-*.md

.EXAMPLE
    # Check off specific files
    .\check-off-review.ps1 -Files 8.2-review-5-server-core.md, 8.2-review-5-server-integration.md, 8.2-review-5-frontend.md
#>

param(
    [Parameter(Mandatory, Position = 0, ValueFromRemainingArguments)]
    [string[]] $Files
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Regex: matches ### or #### followed by a finding ID (C-N, I-N, M-N) that is NOT already struck through
# Group 1: heading hashes (### or ####)
# Group 2: finding ID (e.g. C-1, I-12, M-3)
# Group 3: rest of the title (e.g. ": Some title text")
$pattern = '^(#{3,4})\s+([A-Z]-\d+)(:.*)'

$totalFiles = 0
$totalChecked = 0

foreach ($glob in $Files) {
    # Resolve relative to current working directory, then try as-is
    $resolved = Get-Item -Path $glob -ErrorAction SilentlyContinue
    if (-not $resolved) {
        Write-Warning "No files matched: $glob"
        continue
    }

    foreach ($file in $resolved) {
        $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $lines = $content -split "`n"
        $newLines = [System.Collections.Generic.List[string]]::new()
        $fileChecked = 0

        foreach ($line in $lines) {
            if ($line -match $pattern) {
                $hashes  = $Matches[1]
                $id      = $Matches[2]
                $rest    = $Matches[3]
                $newLine = "$hashes ~~$id~~ [x]$rest"
                $newLines.Add($newLine)
                $fileChecked++
            } else {
                $newLines.Add($line)
            }
        }

        $newContent = $newLines -join "`n"
        Set-Content -LiteralPath $file.FullName -Value $newContent -Encoding UTF8 -NoNewline

        Write-Host "  $($file.Name): $fileChecked finding(s) checked off"
        $totalChecked += $fileChecked
        $totalFiles++
    }
}

Write-Host ""
Write-Host "$totalChecked finding(s) checked off across $totalFiles file(s)."
