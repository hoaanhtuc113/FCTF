# CI/CD Stress Test Runner
# Designed for automated testing in CI/CD pipelines
# Exits with proper exit codes and minimal output

param(
    [string]$TestType = "smoke",
    [string]$BaseUrl = "",
    [string]$Username = "",
    [string]$Password = "",
    [int]$ThresholdErrorRate = 10,
    [int]$ThresholdP95 = 2000
)

$ErrorActionPreference = "Stop"

Write-Host "=== FCTF CI/CD Stress Test ===" -ForegroundColor Cyan
Write-Host "Test Type: $TestType" -ForegroundColor Gray
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray

# Validate inputs
if (-not $BaseUrl) {
    Write-Host "ERROR: BASE_URL is required" -ForegroundColor Red
    exit 1
}

if (-not $Username -or -not $Password) {
    Write-Host "ERROR: USERNAME and PASSWORD are required" -ForegroundColor Red
    exit 1
}

# Check k6 installation
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: k6 is not installed" -ForegroundColor Red
    exit 1
}

# Create temp directory for results
$tempDir = Join-Path $env:TEMP "fctf-stress-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "Output directory: $tempDir" -ForegroundColor Gray

# Test files to run in CI/CD (core APIs only)
$ciTests = @(
    "auth-stress.js",
    "challenge-stress.js",
    "team-stress.js",
    "scoreboard-stress.js",
    "users-stress.js"
)

$allPassed = $true
$results = @()

foreach ($testFile in $ciTests) {
    Write-Host ""
    Write-Host "Running: $testFile" -ForegroundColor Cyan
    
    $outputFile = Join-Path $tempDir "$(Split-Path $testFile -Leaf).json"
    
    # Run k6 with summary output
    $k6Args = @(
        "run",
        "-e", "BASE_URL=$BaseUrl",
        "-e", "USERNAME=$Username",
        "-e", "PASSWORD=$Password",
        "-e", "TEST_TYPE=$TestType",
        "--summary-export", $outputFile,
        $testFile
    )
    
    try {
        $output = & k6 @k6Args 2>&1
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -ne 0) {
            Write-Host "FAILED: $testFile (exit code: $exitCode)" -ForegroundColor Red
            $allPassed = $false
        } else {
            Write-Host "PASSED: $testFile" -ForegroundColor Green
        }
        
        # Parse summary if exists
        if (Test-Path $outputFile) {
            $summary = Get-Content $outputFile | ConvertFrom-Json
            
            # Extract key metrics
            $reqDuration = $summary.metrics.http_req_duration.values.'p(95)'
            $reqFailed = $summary.metrics.http_req_failed.values.rate * 100
            
            Write-Host "  P95 Response Time: $([math]::Round($reqDuration, 2))ms" -ForegroundColor Gray
            Write-Host "  Error Rate: $([math]::Round($reqFailed, 2))%" -ForegroundColor Gray
            
            # Check thresholds
            if ($reqFailed -gt $ThresholdErrorRate) {
                Write-Host "  WARNING: Error rate exceeds threshold ($ThresholdErrorRate%)" -ForegroundColor Yellow
                $allPassed = $false
            }
            
            if ($reqDuration -gt $ThresholdP95) {
                Write-Host "  WARNING: P95 exceeds threshold ($ThresholdP95 ms)" -ForegroundColor Yellow
            }
            
            $results += @{
                Test = $testFile
                ExitCode = $exitCode
                P95 = $reqDuration
                ErrorRate = $reqFailed
            }
        }
    }
    catch {
        Write-Host "ERROR: Exception running $testFile - $_" -ForegroundColor Red
        $allPassed = $false
    }
}

# Print final summary
Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
foreach ($result in $results) {
    $status = if ($result.ExitCode -eq 0) { "✓" } else { "✗" }
    $statusColor = if ($result.ExitCode -eq 0) { "Green" } else { "Red" }
    Write-Host "$status $($result.Test)" -ForegroundColor $statusColor
}

Write-Host ""
if ($allPassed) {
    Write-Host "=== ALL TESTS PASSED ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "=== SOME TESTS FAILED ===" -ForegroundColor Red
    exit 1
}
