param(
  [Parameter(Mandatory = $false)]
  [string]$Script = "concurrent_correct_submissions.js",
  [Parameter(Mandatory = $false)]
  [string]$EnvFile
)

# Use the script directory as the base so this runner works regardless of current working directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $EnvFile) { $EnvFile = Join-Path $scriptDir ".env" }

if (-not (Test-Path $EnvFile)) {
  Write-Error "Env file not found: $EnvFile"
  exit 1
}

# Clear ALL test-related environment variables from previous runs
$testVars = @(
  'BASE_URL', 'USERNAME', 'PASSWORD', 'TOKEN', 'TOKEN_FILE', 'TOKEN_LIST',
  'CONCURRENCY', 'STRICT', 'USE_TOKEN_LIST',
  'CHALLENGE_ID', 'CHALLENGE_FLAG', 'WRONG_FLAG', 'CHALLENGE_CATEGORY',
  'START_CHALLENGE_ID', 'STOP_CHALLENGE_ID', 'START_BEFORE_STOP', 'START_WAIT_SECONDS',
  'CHALLENGE_ID_LIST', 'EXPECT_LIMIT', 'EXPECT_MAX_START',
  'MAX_ATTEMPTS_CHALLENGE_ID', 'MAX_ATTEMPTS',
  'TICKET_TITLE', 'TICKET_TYPE', 'TICKET_DESCRIPTION',
  'HINT_ID', 'HINT_TYPE',
  'DYN_FUNCTION', 'DYN_INITIAL', 'DYN_DECAY', 'DYN_MINIMUM',
  'DYN_EXPECTED_SOLVE_COUNT', 'DYN_BASE_SOLVE_COUNT',
  'DYN_POLL_ATTEMPTS', 'DYN_POLL_DELAY_MS'
)

$testVars | ForEach-Object {
  Remove-Item "env:$_" -ErrorAction SilentlyContinue
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line.Length -eq 0) { return }
  if ($line.StartsWith("#")) { return }

  $parts = $line.Split("=", 2)
  if ($parts.Length -ne 2) { return }

  $name = $parts[0].Trim()
  $value = $parts[1].Trim()
  if ($name.Length -eq 0) { return }

  # Only set non-empty values to avoid JavaScript truthy issues with empty strings
  # Empty values are explicitly removed instead of being set
  if ($value.Length -gt 0) {
    Set-Item -Path ("env:" + $name) -Value $value
  } else {
    Remove-Item "env:$name" -ErrorAction SilentlyContinue
  }
}

if ($Script -match "[\\/]" ) {
  $scriptPath = $Script
} else {
  $scriptPath = Join-Path $scriptDir $Script
}

if (-not (Test-Path $scriptPath)) {
  Write-Error "Script not found: $scriptPath"
  exit 1
}

Write-Host "Running k6 with env file: $EnvFile"
Write-Host "Script: $scriptPath"

k6 run $scriptPath
