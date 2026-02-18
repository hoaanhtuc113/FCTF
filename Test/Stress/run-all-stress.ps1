# Stress Test Suite for Contestant APIs

# Parse command line arguments
param(
    [string]$TestType = "load",
    [switch]$SkipAuth = $false,
    [switch]$Quick = $false,
    [string]$Only = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FCTF Stress Test Suite Runner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if k6 is installed
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "Error: k6 is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install k6 from: https://k6.io/docs/get-started/installation/" -ForegroundColor Yellow
    exit 1
}

# Check for .env file
if (-not (Test-Path ".env")) {
    Write-Host "Error: .env file not found" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and update with your configuration" -ForegroundColor Yellow
    exit 1
}

# Load environment variables from .env file
function Load-EnvFile {
    param([string]$Path = ".env")
    $envVars = @{}
    
    if (Test-Path $Path) {
        Get-Content $Path -Encoding UTF8 | ForEach-Object {
            $line = $_.Trim()
            # Skip comments and empty lines
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Length -eq 2) {
                    $key = $parts[0].Trim()
                    $value = $parts[1].Trim()
                    # Remove quotes if present
                    $value = $value -replace '^["'']|["'']$', ''
                    $envVars[$key] = $value
                }
            }
        }
    }
    return $envVars
}

$envVars = Load-EnvFile -Path ".env"

# Override test type for quick smoke test
if ($Quick) {
    $TestType = "smoke"
    Write-Host "Running quick smoke tests..." -ForegroundColor Yellow
}

Write-Host "Test Type: $TestType" -ForegroundColor Green
Write-Host ""

# Define test files
$allTests = @(
    @{Name="Auth"; File="auth-stress.js"; Description="Authentication APIs"},
    @{Name="Challenge"; File="challenge-stress.js"; Description="Challenge management APIs"},
    @{Name="Team"; File="team-stress.js"; Description="Team information APIs"},
    @{Name="Hint"; File="hint-stress.js"; Description="Hint retrieval APIs"},
    @{Name="Scoreboard"; File="scoreboard-stress.js"; Description="Scoreboard APIs"},
    @{Name="Notifications"; File="notifications-stress.js"; Description="Notifications APIs"},
    @{Name="Config"; File="config-stress.js"; Description="Configuration APIs"},
    @{Name="Users"; File="users-stress.js"; Description="User profile APIs"},
    @{Name="ActionLogs"; File="actionlogs-stress.js"; Description="Action logging APIs"},
    @{Name="Tickets"; File="tickets-stress.js"; Description="Ticket system APIs"}
)

# Filter tests if -Only is specified
if ($Only) {
    $testsToRun = $allTests | Where-Object { $_.Name -like "*$Only*" }
    if ($testsToRun.Count -eq 0) {
        Write-Host "Error: No tests found matching '$Only'" -ForegroundColor Red
        exit 1
    }
} else {
    $testsToRun = $allTests
    if ($SkipAuth) {
        $testsToRun = $testsToRun | Where-Object { $_.Name -ne "Auth" }
    }
}

Write-Host "Tests to run: $($testsToRun.Count)" -ForegroundColor Cyan
foreach ($test in $testsToRun) {
    Write-Host "  - $($test.Name): $($test.Description)" -ForegroundColor Gray
}
Write-Host ""

# Results tracking
$results = @()

# Run each test
foreach ($test in $testsToRun) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Running: $($test.Name) - $($test.Description)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $startTime = Get-Date
    
    # Build k6 arguments with environment variables
    $k6Args = @("run")
    
    # Add environment variables from .env file
    foreach ($key in $envVars.Keys) {
        $k6Args += @("-e", "$key=$($envVars[$key])")
    }
    
    # Add test type override
    $k6Args += @("-e", "TEST_TYPE=$TestType")
    
    # Add test file
    $k6Args += $test.File
    
    # Run k6
    $process = Start-Process -FilePath "k6" -ArgumentList $k6Args -NoNewWindow -Wait -PassThru
    
    $endTime = Get-Date
    $duration = $endTime - $startTime
    
    $exitCode = $process.ExitCode
    
    if ($exitCode -eq 0) {
        Write-Host "Success: $($test.Name) completed successfully" -ForegroundColor Green
        $status = "PASS"
    } else {
        Write-Host "Failed: $($test.Name) - Exit code $exitCode" -ForegroundColor Red
        $status = "FAIL"
    }
    
    $results += [PSCustomObject]@{
        Name = $test.Name
        Status = $status
        Duration = $duration
        ExitCode = $exitCode
    }
    
    Write-Host ""
}

# Print summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Test Results Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$passCount = ($results | Where-Object { $_.Status -eq "PASS" } | Measure-Object).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAIL" } | Measure-Object).Count

foreach ($result in $results) {
    $statusSymbol = if ($result.Status -eq "PASS") { "[OK]" } else { "[FAIL]" }
    $statusText = "{0} {1,-15} {2,6} ({3:mm}m {3:ss}s)" -f $statusSymbol, $result.Name, $result.Status, $result.Duration
    
    if ($result.Status -eq "PASS") {
        Write-Host $statusText -ForegroundColor Green
    } else {
        Write-Host $statusText -ForegroundColor Red
    }
}

Write-Host ""
Write-Host ("Total: {0} | Passed: {1} | Failed: {2}" -f $results.Count, $passCount, $failCount)
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "Some tests failed. Check the output above for details." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
