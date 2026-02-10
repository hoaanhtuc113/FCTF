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

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line.Length -eq 0) { return }
  if ($line.StartsWith("#")) { return }

  $parts = $line.Split("=", 2)
  if ($parts.Length -ne 2) { return }

  $name = $parts[0].Trim()
  $value = $parts[1]
  if ($name.Length -eq 0) { return }

  Set-Item -Path ("env:" + $name) -Value $value
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
