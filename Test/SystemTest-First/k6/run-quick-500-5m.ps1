param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [string]$AccountsCsv = ".\k6\accounts.csv",
    [string]$ResultDir = ".\k6-results",
    [double]$AttemptRate = 0.2,
    [int]$ForceChallengeId = 0,
    [int]$TargetVus = 500
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: k6 is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $AccountsCsv)) {
    Write-Host "ERROR: Accounts file not found: $AccountsCsv" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ResultDir)) {
    New-Item -Path $ResultDir -ItemType Directory | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$summaryJson = Join-Path $ResultDir "quick-500-5m-$timestamp.json"
$consoleLog = Join-Path $ResultDir "quick-500-5m-$timestamp.log"
$resolvedAccountsCsv = (Resolve-Path -Path $AccountsCsv).Path

$k6Args = @(
    'run',
    '-e', "BASE_URL=$BaseUrl",
    '-e', "ACCOUNTS_CSV=$resolvedAccountsCsv",
    '-e', "TARGET_VUS=$TargetVus",
    '-e', "ATTEMPT_RATE=$AttemptRate",
    '-e', "FORCE_CHALLENGE_ID=$ForceChallengeId",
    '-e', 'QUICK_TEST=true',
    '--summary-export', $summaryJson,
    '.\k6\contestant-500-1h.js'
)

Write-Host "Running quick test: 500 VUs for ~5 minutes" -ForegroundColor Cyan
Write-Host "Base URL     : $BaseUrl" -ForegroundColor Gray
Write-Host "Accounts CSV : $resolvedAccountsCsv" -ForegroundColor Gray
Write-Host "Summary JSON : $summaryJson" -ForegroundColor Gray

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& k6 @k6Args *>&1 | Tee-Object -FilePath $consoleLog
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction

if (-not (Test-Path $summaryJson)) {
    Write-Host "ERROR: Summary file was not generated: $summaryJson" -ForegroundColor Red
    exit 1
}

Write-Host "Quick test finished with exit code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "Summary JSON: $summaryJson" -ForegroundColor Gray
Write-Host "Console log : $consoleLog" -ForegroundColor Gray

exit $exitCode
