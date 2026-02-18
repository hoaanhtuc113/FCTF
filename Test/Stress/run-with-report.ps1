# Run stress tests with HTML report generation

param(
    [string]$TestType = "load",
    [switch]$Quick = $false,
    [string]$Only = "",
    [string]$OutputDir = "results"
)

# Check if k6 is installed
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "Error: k6 is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install k6 from: https://k6.io/docs/get-started/installation/" -ForegroundColor Yellow
    exit 1
}

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Override test type for quick test
if ($Quick) {
    $TestType = "smoke"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FCTF Stress Test with Reports" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Type: $TestType" -ForegroundColor Green
Write-Host "Output Directory: $OutputDir" -ForegroundColor Green
Write-Host ""

# Load environment variables from .env file
function Load-EnvFile {
    param([string]$Path = ".env")
    $envVars = @{}
    
    if (Test-Path $Path) {
        Get-Content $Path | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Length -eq 2) {
                    $key = $parts[0].Trim()
                    $value = $parts[1].Trim()
                    $value = $value -replace '^["'']|["'']$', ''
                    $envVars[$key] = $value
                }
            }
        }
    }
    return $envVars
}

$envVars = Load-EnvFile -Path ".env"

# Define test files
$allTests = @(
    @{Name="auth"; File="auth-stress.js"},
    @{Name="challenge"; File="challenge-stress.js"},
    @{Name="team"; File="team-stress.js"},
    @{Name="hint"; File="hint-stress.js"},
    @{Name="scoreboard"; File="scoreboard-stress.js"},
    @{Name="notifications"; File="notifications-stress.js"},
    @{Name="config"; File="config-stress.js"},
    @{Name="users"; File="users-stress.js"},
    @{Name="actionlogs"; File="actionlogs-stress.js"},
    @{Name="tickets"; File="tickets-stress.js"}
)

# Filter tests if needed
if ($Only) {
    $testsToRun = $allTests | Where-Object { $_.Name -like "*$Only*" }
} else {
    $testsToRun = $allTests
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$results = @()

# Run each test with JSON output
foreach ($test in $testsToRun) {
    Write-Host "Running: $($test.Name)..." -ForegroundColor Cyan
    
    $outputFile = Join-Path $OutputDir "$($test.Name)_${timestamp}.json"
    
    # Build k6 arguments
    $k6Args = @("run")
    
    # Add environment variables from .env file
    foreach ($key in $envVars.Keys) {
        $k6Args += @("-e", "$key=$($envVars[$key])")
    }
    
    # Add test type override
    $k6Args += @("-e", "TEST_TYPE=$TestType")
    
    # Add JSON output
    $k6Args += @("--out", "json=$outputFile")
    
    # Add test file
    $k6Args += $test.File
    
    # Run k6
    $process = Start-Process -FilePath "k6" -ArgumentList $k6Args -NoNewWindow -Wait -PassThru
    
    $results += @{
        Name = $test.Name
        ExitCode = $process.ExitCode
        OutputFile = $outputFile
    }
    
    if ($process.ExitCode -eq 0) {
        Write-Host "✓ $($test.Name) completed" -ForegroundColor Green
    } else {
        Write-Host "✗ $($test.Name) failed" -ForegroundColor Red
    }
}

# Generate summary report
Write-Host ""
Write-Host "Generating summary report..." -ForegroundColor Cyan

$summaryFile = Join-Path $OutputDir "summary_${timestamp}.html"

$html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>FCTF Stress Test Report - $timestamp</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 40px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 3px solid #4CAF50; padding-bottom: 10px; }
        .info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th { background: #4CAF50; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #ddd; }
        tr:hover { background: #f5f5f5; }
        .pass { color: #4CAF50; font-weight: bold; }
        .fail { color: #f44336; font-weight: bold; }
        .footer { margin-top: 30px; text-align: center; color: #777; }
    </style>
</head>
<body>
    <h1>🚀 FCTF Stress Test Report</h1>
    <div class="info">
        <strong>Test Type:</strong> $TestType<br>
        <strong>Timestamp:</strong> $timestamp<br>
        <strong>Tests Run:</strong> $($results.Count)
    </div>
    <table>
        <thead>
            <tr>
                <th>Test Name</th>
                <th>Status</th>
                <th>Output File</th>
            </tr>
        </thead>
        <tbody>
"@

foreach ($result in $results) {
    $status = if ($result.ExitCode -eq 0) { "PASS" } else { "FAIL" }
    $statusClass = if ($result.ExitCode -eq 0) { "pass" } else { "fail" }
    $outputFileName = Split-Path $result.OutputFile -Leaf
    
    $html += @"
            <tr>
                <td>$($result.Name)</td>
                <td class="$statusClass">$status</td>
                <td><a href="$outputFileName">$outputFileName</a></td>
            </tr>
"@
}

$html += @"
        </tbody>
    </table>
    <div class="footer">
        Generated by FCTF Stress Test Suite
    </div>
</body>
</html>
"@

$html | Out-File -FilePath $summaryFile -Encoding UTF8

Write-Host ""
Write-Host "✓ Summary report generated: $summaryFile" -ForegroundColor Green
Write-Host ""
Write-Host "Opening report in browser..." -ForegroundColor Cyan
Start-Process $summaryFile

$passCount = ($results | Where-Object { $_.ExitCode -eq 0 }).Count
$failCount = ($results | Where-Object { $_.ExitCode -ne 0 }).Count

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Results: $passCount passed, $failCount failed" -ForegroundColor $(if ($failCount -gt 0) { "Yellow" } else { "Green" })
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($failCount -gt 0) { 1 } else { 0 })
