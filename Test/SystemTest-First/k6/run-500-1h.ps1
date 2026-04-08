param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [string]$AccountsCsv = ".\k6\accounts.csv",
    [string]$ResultDir = ".\k6-results",
    [int]$TargetVus = 500,
    [int]$TopCount = 10,
    [double]$AttemptRate = 0.2,
    [int]$ForceChallengeId = 0
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Get-MetricValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Metric,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [double]$Default = 0
    )

    if ($null -eq $Metric) {
        return $Default
    }

    if ($Metric.PSObject.Properties.Name -contains 'values') {
        $values = $Metric.values
        if ($null -ne $values -and $values.PSObject.Properties.Name -contains $Name) {
            return [double]$values.$Name
        }
    }

    if ($Metric.PSObject.Properties.Name -contains $Name) {
        return [double]$Metric.$Name
    }

    return $Default
}

function Get-DataRowsCount {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    $lines = Get-Content -Path $FilePath -Encoding UTF8 | Where-Object {
        $trimmed = $_.Trim()
        $trimmed -and -not $trimmed.StartsWith('#')
    }

    if ($lines.Count -le 1) {
        return 0
    }

    return ($lines.Count - 1)
}

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: k6 is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install: winget install k6" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $AccountsCsv)) {
    Write-Host "ERROR: Accounts file not found: $AccountsCsv" -ForegroundColor Red
    Write-Host "Hint: copy .\k6\accounts-template-500.csv to .\k6\accounts.csv and replace with real accounts." -ForegroundColor Yellow
    exit 1
}

$accountCount = Get-DataRowsCount -FilePath $AccountsCsv
if ($accountCount -lt $TargetVus) {
    Write-Host "ERROR: Need at least $TargetVus accounts, found $accountCount in $AccountsCsv" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ResultDir)) {
    New-Item -Path $ResultDir -ItemType Directory | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$summaryJson = Join-Path $ResultDir "k6-summary-$timestamp.json"
$consoleLog = Join-Path $ResultDir "k6-console-$timestamp.log"
$reportMd = Join-Path $ResultDir "k6-report-$timestamp.md"
$resolvedAccountsCsv = (Resolve-Path -Path $AccountsCsv).Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FCTF Contestant 500 Accounts - 1h" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Base URL     : $BaseUrl" -ForegroundColor Gray
Write-Host "Accounts CSV : $AccountsCsv" -ForegroundColor Gray
Write-Host "Account count: $accountCount" -ForegroundColor Gray
Write-Host "Target VUs   : $TargetVus" -ForegroundColor Gray
Write-Host "Result dir   : $ResultDir" -ForegroundColor Gray
Write-Host ""

$k6Args = @(
    'run',
    '-e', "BASE_URL=$BaseUrl",
    '-e', "ACCOUNTS_CSV=$resolvedAccountsCsv",
    '-e', "TARGET_VUS=$TargetVus",
    '-e', "TOP_COUNT=$TopCount",
    '-e', "ATTEMPT_RATE=$AttemptRate",
    '-e', "FORCE_CHALLENGE_ID=$ForceChallengeId",
    '--summary-export', $summaryJson,
    '.\k6\contestant-500-1h.js'
)

$startTime = Get-Date
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& k6 @k6Args *>&1 | Tee-Object -FilePath $consoleLog
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
$endTime = Get-Date
$duration = New-TimeSpan -Start $startTime -End $endTime

if (-not (Test-Path $summaryJson)) {
    Write-Host "ERROR: Summary file was not generated: $summaryJson" -ForegroundColor Red
    exit 1
}

$summary = Get-Content -Path $summaryJson -Encoding UTF8 | ConvertFrom-Json

$p95 = [math]::Round((Get-MetricValue -Metric $summary.metrics.http_req_duration -Name 'p(95)'), 2)
$p99 = [math]::Round((Get-MetricValue -Metric $summary.metrics.http_req_duration -Name 'p(99)'), 2)
$avg = [math]::Round((Get-MetricValue -Metric $summary.metrics.http_req_duration -Name 'avg'), 2)
$med = [math]::Round((Get-MetricValue -Metric $summary.metrics.http_req_duration -Name 'med'), 2)
$errorRate = [math]::Round(((Get-MetricValue -Metric $summary.metrics.http_req_failed -Name 'rate') * 100), 3)
$checksRate = [math]::Round(((Get-MetricValue -Metric $summary.metrics.checks -Name 'value') * 100), 3)
$flowRate = [math]::Round(((Get-MetricValue -Metric $summary.metrics.portal_flow_success -Name 'value') * 100), 3)
$httpReqRate = [math]::Round((Get-MetricValue -Metric $summary.metrics.http_reqs -Name 'rate'), 2)

$report = @"
# FCTF k6 Report (500 accounts / 1 hour)

- Base URL: $BaseUrl
- Accounts file: $AccountsCsv
- Accounts loaded: $accountCount
- Target VUs: $TargetVus
- Started at: $startTime
- Finished at: $endTime
- Actual duration: $([int]$duration.TotalMinutes) minutes $($duration.Seconds) seconds
- k6 exit code: $exitCode

## Key latency metrics

- http_req_duration p95: **$p95 ms**
- http_req_duration p99: **$p99 ms**
- http_req_duration avg: **$avg ms**
- http_req_duration median: **$med ms**
- http_reqs rate: **$httpReqRate req/s**
- http_req_failed: **$errorRate %**
- checks pass rate: **$checksRate %**
- portal_flow_success: **$flowRate %**

## Output files

- Summary JSON: $summaryJson
- Console log: $consoleLog
"@

Set-Content -Path $reportMd -Value $report -Encoding UTF8

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Run finished with exit code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "P95 latency : $p95 ms" -ForegroundColor Gray
Write-Host "P99 latency : $p99 ms" -ForegroundColor Gray
Write-Host "Error rate  : $errorRate %" -ForegroundColor Gray
Write-Host "Report      : $reportMd" -ForegroundColor Gray
Write-Host "Summary JSON: $summaryJson" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

exit $exitCode
