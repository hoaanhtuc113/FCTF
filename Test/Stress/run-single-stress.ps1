# Run a single stress test with custom parameters

param(
    [Parameter(Mandatory=$true)]
    [string]$TestFile,
    
    [string]$TestType = "load",
    [string]$BaseUrl = "",
    [string]$Username = "",
    [string]$Password = "",
    [string]$Token = ""
)

# Check if k6 is installed
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "Error: k6 is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install k6 from: https://k6.io/docs/get-started/installation/" -ForegroundColor Yellow
    exit 1
}

# Check if test file exists
if (-not (Test-Path $TestFile)) {
    Write-Host "Error: Test file '$TestFile' not found" -ForegroundColor Red
    exit 1
}

Write-Host "Running stress test: $TestFile" -ForegroundColor Cyan
Write-Host "Test Type: $TestType" -ForegroundColor Green
Write-Host ""

# Load environment variables from .env file if exists and no direct params provided
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

# Build k6 arguments
$k6Args = @("run")

# Load .env if exists and merge with command-line overrides
if (Test-Path ".env") {
    $envVars = Load-EnvFile -Path ".env"
    foreach ($key in $envVars.Keys) {
        $k6Args += @("-e", "$key=$($envVars[$key])")
    }
}

# Add environment overrides (command-line parameters take precedence)
$k6Args += @("-e", "TEST_TYPE=$TestType")

if ($BaseUrl) {
    $k6Args += @("-e", "BASE_URL=$BaseUrl")
}
if ($Username) {
    $k6Args += @("-e", "USERNAME=$Username")
}
if ($Password) {
    $k6Args += @("-e", "PASSWORD=$Password")
}
if ($Token) {
    $k6Args += @("-e", "TOKEN=$Token")
}

# Add test file
$k6Args += $TestFile

# Run k6
$process = Start-Process -FilePath "k6" -ArgumentList $k6Args -NoNewWindow -Wait -PassThru

exit $process.ExitCode
