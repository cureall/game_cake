#requires -Version 5.1
<#
 .SYNOPSIS
  One-shot initializer: create private GitHub repo + push current project.

  Assumed location: <projectRoot>/git_tool_script/init_push.ps1
  Run it from anywhere (double-click via a wrapper, or from PowerShell).

  Behaviour:
  - Auto-detects projectRoot (parent of this script's folder) and projectName.
  - Reuses token stored in git credential helper (does NOT print it).
  - Checks https://github.com/cureall/<projectName>: if exists, aborts.
  - Otherwise: creates private repo, applies a conservative .gitignore,
    inits git if needed, adds origin, pushes to main.
  - After this one-shot, use plain `git push` / `git pull`.

  Usage (system PowerShell, NOT the Trae sandbox terminal):
    cd <projectRoot>\git_tool_script
    powershell -ExecutionPolicy Bypass -File init_push.ps1
#>
# ---------- proxy & protocols ----------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:HTTP_PROXY="http://192.168.31.199:7890"
$env:HTTPS_PROXY="http://192.168.31.199:7890"

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- config ----------
$owner = 'cureall'

# ---------- locate project root (independent of CWD) ----------
$scriptDir   = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$projectRoot = Split-Path -Parent $scriptDir
$projectName = Split-Path -Leaf $projectRoot

if (-not $projectName) { Write-Host "FATAL: cannot determine project name from '$projectRoot'" -ForegroundColor Red; exit 1 }

Write-Host "projectRoot = $projectRoot"
Write-Host "projectName = $projectName"
Write-Host "target      = https://github.com/$owner/$projectName"
Write-Host ""

# ---------- get token from git credential helper (do NOT print) ----------
$inp = @"
protocol=https
host=github.com

"@
try {
    $out = $inp | & git credential fill 2>$null
} catch {
    Write-Host "FATAL: git credential fill failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
$line = $out | Where-Object { $_ -match '^password=' } | Select-Object -First 1
if (-not $line) {
    Write-Host "FATAL: no github token in credential helper. Push any repo to github once first." -ForegroundColor Red
    exit 1
}
$token = ($line -replace '^password=','').Trim()

$headers = @{
    Authorization            = "Bearer $token"
    Accept                   = 'application/vnd.github+json'
    'X-GitHub-Api-Version'   = '2022-11-28'
}

# ---------- check if remote repo already exists ----------
Write-Host "Checking remote repo..." -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "https://api.github.com/repos/$owner/$projectName" -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop -TimeoutSec 20 -Proxy 'http://192.168.31.199:7890'
    Write-Host "repository exists." -ForegroundColor Yellow
    Write-Host "Aborting. To reuse it manually:  cd '$projectRoot';  git remote add origin https://github.com/$owner/$projectName.git;  git push -u origin main"
    exit 0
}
catch {
    $sc = $_.Exception.Response.StatusCode.value__
    if ($sc -ne 404) {
        Write-Host "FATAL: API check failed (status $sc): $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
    Write-Host "Remote repo does not exist. Creating..." -ForegroundColor Cyan
}

# ---------- create private repo ----------
$body = @{ name = $projectName; private = $true; auto_init = $false } | ConvertTo-Json -Compress
try {
    $null = Invoke-WebRequest -Uri 'https://api.github.com/user/repos' -Headers $headers -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing -ErrorAction Stop -TimeoutSec 30 -Proxy 'http://192.168.31.199:7890'
    Write-Host "Created private repo: https://github.com/$owner/$projectName" -ForegroundColor Green
}
catch {
    Write-Host "FATAL: create repo failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ---------- apply .gitignore (conservative, idempotent) ----------
$marker   = '# ===== auto-managed by init_push.ps1 (do not edit this block) ====='
$giBlock  = @"
$marker
# Secrets / credentials
.env
.env.*
!.env.example
credentials.json
*_secret*.json
*.secret
*.key

# IDE / local tool state
.trae/
.claude/
.codebuddy/
.workbuddy/
.cursor/
.idea/
.vscode/
**/settings.local.json

# Databases
*.db
*.sqlite
*.sqlite3

# SynologyDrive / Windows junk
*.lnk
@eaDir/
desktop.ini
Thumbs.db

# Tool artifacts
scan_baseline.json
scan_history.md
# ===== end auto-managed =====
"@
$giPath = Join-Path $projectRoot '.gitignore'
$existing = if (Test-Path -LiteralPath $giPath) { [IO.File]::ReadAllText($giPath) } else { '' }
if (-not $existing.Contains($marker)) {
    [IO.File]::AppendAllText($giPath, "`r`n$giBlock`r`n", (New-Object Text.UTF8Encoding $false))
    Write-Host ".gitignore: appended conservative rules (secrets + *.db + *.lnk + IDE state)" -ForegroundColor Green
} else {
    Write-Host ".gitignore: already managed, skipped" -ForegroundColor DarkGray
}

# ---------- git init / commit ----------
Push-Location $projectRoot
try {
    if (-not (Test-Path .git)) {
        git init --quiet
        Write-Host "git: initialized" -ForegroundColor Green
    }
    git add -A 2>&1 | Out-Null
    $cnt = 0
    [int]::TryParse((git rev-list --count HEAD 2>$null), [ref]$cnt) | Out-Null
    if ($cnt -eq 0) {
        git commit -m 'initial commit' --quiet 2>&1 | ForEach-Object { Write-Host "  commit: $_" }
    } else {
        # commit any pending changes introduced by the new gitignore
        $pending = git status --porcelain
        if ($pending) { git commit -m 'chore: apply gitignore' --quiet 2>&1 | Out-Null }
    }
    git branch -M main 2>&1 | Out-Null

    # ---------- origin + push ----------
    $url = "https://github.com/$owner/$projectName.git"
    $cur = git remote get-url origin 2>$null
    if ($cur -and $cur -ne $url) { git remote remove origin 2>&1 | Out-Null; $cur = $null }
    if (-not $cur) { git remote add origin $url }
    Write-Host "Pushing to $url ..." -ForegroundColor Cyan
    git push -u origin main 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "DONE. https://github.com/$owner/$projectName" -ForegroundColor Green
        Write-Host "Next time just:  git push  /  git pull"
    } else {
        Write-Host "Push failed (exit $LASTEXITCODE). Check output above." -ForegroundColor Red
        exit 1
    }
}
finally {
    Pop-Location
}
