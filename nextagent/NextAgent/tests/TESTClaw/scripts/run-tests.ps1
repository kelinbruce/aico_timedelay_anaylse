<#
.SYNOPSIS
    Run TESTClaw binary-package tests with extended timeouts and full output logging.

.DESCRIPTION
    Runs NextAgent binary-package (TESTClaw) tests: Vitest backend tests and/or
    Playwright E2E UI tests. All stdout+stderr is logged to a timestamped log file
    under test-output/. Each phase is timed individually; total elapsed time is
    reported in the summary.

.PARAMETER Backend
    Run Vitest backend tests (default if no scope specified).

.PARAMETER E2E
    Run Playwright E2E UI tests. Requires NextAgent service running.

.PARAMETER All
    Equivalent to -Backend -E2E.

.PARAMETER NoSelfCheck
    Skip the pre-flight self-check (nextagent-self-check).

.PARAMETER NoStart
    Skip auto-starting NextAgent service before E2E tests.
    Use when the service is already running.

.PARAMETER KeepRunning
    Do not stop NextAgent service after E2E tests complete.

.EXAMPLE
    .\scripts\run-tests.ps1
    Run Vitest backend tests.

.EXAMPLE
    .\scripts\run-tests.ps1 -All
    Run backend + E2E tests. Auto-starts and stops NextAgent service.

.EXAMPLE
    .\scripts\run-tests.ps1 -E2E -NoStart
    Run E2E tests only, assuming NextAgent is already running.
#>

[CmdletBinding()]
param(
    [switch]$Backend,
    [switch]$E2E,
    [switch]$All,
    [switch]$NoSelfCheck,
    [switch]$NoStart,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

# Fix terminal encoding for Chinese test names
chcp 65001 > $null 2>&1
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# --- Config ---
$TestclawDir = $PSScriptRoot | Split-Path
$TargetDir   = Join-Path -Path $TestclawDir -ChildPath "target"
$LogDir      = Join-Path -Path $TestclawDir -ChildPath "test-output"

if ($All) { $Backend = $true; $E2E = $true }
if (-not $Backend -and -not $E2E) { $Backend = $true }

# --- Validate target dir ---
if (-not (Test-Path $TargetDir)) {
    Write-Host "[ERROR] target/ directory not found: $TargetDir" -ForegroundColor Red
    Write-Host "        Extract the NextAgent binary package to tests/TESTClaw/target/ first." -ForegroundColor Red
    exit 1
}

# --- Validate API environment variables ---
if (-not $env:OPENAI_API_KEY) {
    Write-Host "[ERROR] OPENAI_API_KEY environment variable is not set." -ForegroundColor Red
    Write-Host "        Set it before running:" -ForegroundColor Red
    Write-Host '        $env:OPENAI_API_KEY="your-key"' -ForegroundColor Yellow
    Write-Host '        $env:OPENAI_BASE_URL="https://api.minimaxi.com/v1"' -ForegroundColor Yellow
    Write-Host '        $env:OPENAI_MODEL_NAME="MiniMax-M2.7-highspeed"' -ForegroundColor Yellow
    exit 1
}

# --- Global timer ---
$globalTimer = [System.Diagnostics.Stopwatch]::StartNew()
$phaseTimes  = @{}

# Progress timer: shows elapsed time every 60 seconds
$progressCts = $null
try {
    $progressCts = [System.Threading.CancellationTokenSource]::new()
    $progressTimer = [System.Threading.Tasks.Task]::Run({
        while (-not $progressCts.IsCancellationRequested) {
            [System.Threading.Tasks.Task]::Delay(60000, $progressCts.Token).Wait()
            if (-not $progressCts.IsCancellationRequested) {
                $e = $globalTimer.Elapsed.ToString("hh\:mm\:ss")
                Write-Host "  [progress] Elapsed: $e" -ForegroundColor DarkGray
            }
        }
    }, $progressCts.Token)
} catch { <# progress timer is optional #> }

# --- Log file ---
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "testclaw-$timestamp.log"

function Write-Log {
    param([string]$Message)
    $ts   = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Run-Command {
    param(
        [string]$Label,
        [string[]]$Command,
        [string]$WorkingDir
    )
    Write-Log ">>> $Label"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $prevDir = $null
        if ($WorkingDir) {
            $prevDir = Get-Location
            Set-Location $WorkingDir
        }
        $prevErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $Command[0] @($Command[1..($Command.Length - 1)]) 2>&1 | ForEach-Object {
            Write-Host $_
            Add-Content -Path $LogFile -Value ($_ | Out-String) -Encoding utf8
        }
        $ErrorActionPreference = $prevErrorActionPreference
        $exitCode = $LASTEXITCODE
        if ($prevDir) { Set-Location $prevDir }
    }
    catch {
        if ($prevErrorActionPreference) { $ErrorActionPreference = $prevErrorActionPreference }
        $_ | Out-String | Add-Content -Path $LogFile -Encoding utf8
        $exitCode = 1
        if ($prevDir) { Set-Location $prevDir }
    }
    $sw.Stop()
    $status  = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
    $elapsed = $sw.Elapsed.ToString("hh\:mm\:ss")
    $phaseTimes[$Label] = $sw.Elapsed
    Write-Log "<<< $Label [$status] ($elapsed)"
    return $exitCode
}

# --- Pre-flight self-check ---
if ((-not $NoSelfCheck) -and (Test-Path (Join-Path $TargetDir "bin\nextagent-self-check"))) {
    $checkResult = Run-Command -Label "self-check" -Command @("node", "bin\nextagent-self-check") -WorkingDir $TargetDir
    if ($checkResult -ne 0) {
        Write-Log "Self-check failed. Fix configuration before running tests."
        Write-Log "Full log: $LogFile"
        exit 1
    }
}

# --- Start NextAgent for E2E ---
$startedService = $false
if ($E2E -and -not $NoStart) {
    Write-Log ">>> start NextAgent (background)"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Start-Process -FilePath "node" -ArgumentList "bin\nextagent-start" -WorkingDirectory $TargetDir -WindowStyle Hidden -PassThru | Out-Null
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            try {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 2
                if ($r.StatusCode -eq 200) { $ready = $true; break }
            } catch { <# not ready yet #> }
        }
        $sw.Stop()
        $elapsed = $sw.Elapsed.ToString("hh\:mm\:ss")
        if ($ready) {
            $startedService = $true
            Write-Log "<<< start NextAgent [PASS] ($elapsed)"
            $phaseTimes["start NextAgent"] = $sw.Elapsed
        } else {
            Write-Log "<<< start NextAgent [FAIL] ($elapsed)"
            Write-Log "NextAgent did not become ready within 30s. Cannot run E2E tests."
            Write-Log "Full log: $LogFile"
            exit 1
        }
    } catch {
        $sw.Stop()
        $elapsed = $sw.Elapsed.ToString("hh\:mm\:ss")
        Write-Log "<<< start NextAgent [FAIL] ($elapsed)"
        Write-Log "Failed to start NextAgent: $_"
        Write-Log "Full log: $LogFile"
        exit 1
    }
}

# --- Verify NextAgent is reachable for E2E (NoStart mode) ---
if ($E2E -and $NoStart) {
    Write-Log "Verifying NextAgent service is reachable (NoStart mode)..."
    $reachable = $false
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 3
        $reachable = $true
    } catch { <# not reachable #> }
    if (-not $reachable) {
        Write-Log "[ERROR] NextAgent is not running at http://127.0.0.1:3000"
        Write-Log "        Either start it first, or remove -NoStart to auto-start."
        Write-Log "Full log: $LogFile"
        exit 1
    }
    Write-Log "NextAgent is reachable."
}

# --- Resolve npm.cmd path ---
$npmCmd = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
if (-not (Test-Path $npmCmd)) { $npmCmd = "npm.cmd" }

# --- Run Vitest backend tests ---
$backendResult = 0
if ($Backend) {
    $backendResult = Run-Command -Label "vitest backend" -Command @($npmCmd, "run", "test") -WorkingDir $TestclawDir
}

# --- Run Playwright E2E tests (always runs even if backend failed) ---
$e2eResult = 0
if ($E2E) {
    $e2eResult = Run-Command -Label "playwright e2e" -Command @($npmCmd, "run", "test:e2e") -WorkingDir $TestclawDir
}

# --- Stop NextAgent ---
if ($startedService -and -not $KeepRunning) {
    Run-Command -Label "stop NextAgent" -Command @("node", "bin\nextagent-stop") -WorkingDir $TargetDir | Out-Null
}

# --- Stop progress timer ---
if ($progressCts) { $progressCts.Cancel() }

# --- Summary ---
Write-Log ""
Write-Log "===== TestClaw Run Summary ====="
Write-Log "Log file: $LogFile"

Write-Log ""
Write-Log "--- Timing ---"
$phaseTimes.GetEnumerator() | Sort-Object Name | ForEach-Object {
    $dur = $_.Value.ToString("hh\:mm\:ss")
    Write-Log ("  {0,-30} {1}" -f $_.Key, $dur)
}
$globalTimer.Stop()
$totalDur = $globalTimer.Elapsed.ToString("hh\:mm\:ss")
Write-Log ("  {0,-30} {1}" -f "TOTAL", $totalDur)

Write-Log ""
Write-Log "--- Results ---"
if ($Backend) {
    $bStatus = if ($backendResult -eq 0) { "PASS" } else { "FAIL" }
    Write-Log "Backend (Vitest):  $bStatus"
}
if ($E2E) {
    $eStatus = if ($e2eResult -eq 0) { "PASS" } else { "FAIL" }
    Write-Log "E2E (Playwright):  $eStatus"
}
if ($KeepRunning -and $startedService) {
    Write-Log "NextAgent service: still running (-KeepRunning was set)"
}

$allResults = @($backendResult, $e2eResult)
$failCount  = ($allResults | Where-Object { $_ -ne 0 }).Count
if ($failCount -eq 0) {
    Write-Log "Overall: PASS"
    exit 0
} else {
    Write-Log "Overall: FAIL"
    exit 1
}
