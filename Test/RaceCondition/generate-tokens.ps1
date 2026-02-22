param(
  [Parameter(Mandatory = $false)]
  [int]$Start = 1,
  [Parameter(Mandatory = $false)]
  [int]$End = 1000,
  [Parameter(Mandatory = $false)]
  [string]$Password = "1",
  [Parameter(Mandatory = $false)]
  [string]$EnvFile = "",
  [Parameter(Mandatory = $false)]
  [string]$OutDir = "",
  [Parameter(Mandatory = $false)]
  [int]$SleepMs = 0
)

# Resolve paths relative to this script's directory so the tool works after folder moves
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $EnvFile) {
  $candidate = Join-Path $scriptDir ".env"
  if (Test-Path $candidate) {
    $EnvFile = $candidate
  } else {
    Write-Error "Cannot find .env file. Please specify -EnvFile parameter."
    exit 1
  }
}

if (-not $OutDir) {
  $OutDir = $scriptDir
}

function Load-EnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    Write-Error "Env file not found: $Path"
    exit 1
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }

    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) { return }

    $name = $parts[0].Trim()
    $value = $parts[1]
    if ($name.Length -eq 0) { return }

    Set-Item -Path "env:$name" -Value $value
  }
}

Load-EnvFile -Path $EnvFile

$baseUrl = $env:BASE_URL
if (-not $baseUrl) { $baseUrl = "http://localhost:5000" }
$baseUrl = $baseUrl.TrimEnd('/')
$loginUrl = "$baseUrl/api/Auth/login-contestant"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$tokens = New-Object System.Collections.Generic.List[string]

for ($i = $Start; $i -le $End; $i += 1) {
  $username = "user$i"
  try {
    $body = @{ username = $username; password = $Password } | ConvertTo-Json
    $resp = Invoke-RestMethod -Method Post -Uri $loginUrl -Body $body -ContentType "application/json"
    if ($resp -and $resp.generatedToken) {
      $tokens.Add($resp.generatedToken)
    } else {
      Write-Warning "No token for $username"
    }
  } catch {
    Write-Warning "Login failed for ${username}: $($_.Exception.Message)"
  }

  if ($SleepMs -gt 0) {
    Start-Sleep -Milliseconds $SleepMs
  }

  if ($i % 50 -eq 0) {
    Write-Host "Processed $i users"
  }
}

$tokensTxt = Join-Path $OutDir "tokens.txt"
$tokensCsv = Join-Path $OutDir "tokens.csv"

$tokens | Set-Content -Path $tokensTxt -Encoding ASCII
($tokens -join ",") | Set-Content -Path $tokensCsv -Encoding ASCII

Write-Host "Tokens saved: $tokensTxt"
Write-Host "Tokens CSV saved: $tokensCsv"
Write-Host "Total tokens: $($tokens.Count)"
