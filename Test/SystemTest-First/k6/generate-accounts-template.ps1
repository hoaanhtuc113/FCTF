param(
    [string]$OutputPath = ".\k6\accounts-template-500.csv",
    [int]$Count = 500,
    [string]$UsernamePrefix = "contestant",
    [string]$DefaultPassword = "ChangeMe123!"
)

$ErrorActionPreference = 'Stop'

if ($Count -lt 1) {
    Write-Host "ERROR: Count must be >= 1" -ForegroundColor Red
    exit 1
}

$dir = Split-Path -Parent $OutputPath
if ($dir -and -not (Test-Path $dir)) {
    New-Item -Path $dir -ItemType Directory | Out-Null
}

$rows = @("username,password")
for ($i = 1; $i -le $Count; $i++) {
    $username = '{0}{1:D3}' -f $UsernamePrefix, $i
    $rows += "$username,$DefaultPassword"
}

Set-Content -Path $OutputPath -Value $rows -Encoding UTF8
Write-Host "Generated: $OutputPath ($Count accounts)" -ForegroundColor Green
