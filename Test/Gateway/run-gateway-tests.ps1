param(
  [Parameter(Mandatory = $false)]
  [string]$EnvFile = ".env",

  [Parameter(Mandatory = $false)]
  [ValidateSet("all", "integration", "security", "resilience", "load", "spike", "soak", "tcp", "quick")]
  [string]$Type = "all",

  [Parameter(Mandatory = $false)]
  [switch]$SkipTcp,

  [Parameter(Mandatory = $false)]
  [switch]$SkipLongRunning,

  [Parameter(Mandatory = $false)]
  [switch]$StopOnFail
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

function Load-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    Write-Error "Env file not found: $Path"
    exit 1
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }

    $parts = $line.Split('=', 2)
    if ($parts.Length -ne 2) { return }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (-not $name) { return }

    Set-Item -Path ("env:" + $name) -Value $value
  }
}

function ConvertTo-Base64UrlNoPadding {
  param([byte[]]$Bytes)
  $base64 = [Convert]::ToBase64String($Bytes)
  return $base64.TrimEnd('=') -replace '\+', '-' -replace '/', '_'
}

function New-ChallengeToken {
  param(
    [string]$PrivateKey,
    [string]$Route,
    [int]$ExpiresInSeconds,
    [bool]$Expired
  )

  if (-not $Route) {
    return $null
  }

  $exp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $ExpiresInSeconds
  if ($Expired) {
    $exp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [Math]::Abs($ExpiresInSeconds)
  }

  $payloadObj = [ordered]@{
    exp = $exp
    route = $Route
  }
  $payloadJson = $payloadObj | ConvertTo-Json -Compress
  $payloadB64 = ConvertTo-Base64UrlNoPadding -Bytes ([Text.Encoding]::UTF8.GetBytes($payloadJson))

  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($PrivateKey))
  try {
    $sigBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payloadB64))
  }
  finally {
    $hmac.Dispose()
  }

  $sigB64 = ConvertTo-Base64UrlNoPadding -Bytes $sigBytes
  return "$payloadB64.$sigB64"
}

function Ensure-TokenVars {
  $validToken = (Get-Item -Path Env:VALID_TOKEN -ErrorAction SilentlyContinue).Value
  $expiredToken = (Get-Item -Path Env:EXPIRED_TOKEN -ErrorAction SilentlyContinue).Value
  $invalidToken = (Get-Item -Path Env:INVALID_TOKEN -ErrorAction SilentlyContinue).Value
  $brokenToken = (Get-Item -Path Env:BROKEN_TOKEN -ErrorAction SilentlyContinue).Value

  $privateKey = (Get-Item -Path Env:PRIVATE_KEY -ErrorAction SilentlyContinue).Value
  $route = (Get-Item -Path Env:CHALLENGE_ROUTE -ErrorAction SilentlyContinue).Value
  $brokenRoute = (Get-Item -Path Env:BROKEN_ROUTE -ErrorAction SilentlyContinue).Value

  if (-not $validToken -and $privateKey -and $route) {
    $validToken = New-ChallengeToken -PrivateKey $privateKey -Route $route -ExpiresInSeconds 3600 -Expired:$false
    Set-Item -Path Env:VALID_TOKEN -Value $validToken
    Write-Host "Generated VALID_TOKEN from PRIVATE_KEY + CHALLENGE_ROUTE" -ForegroundColor Green
  }

  if (-not $expiredToken -and $privateKey -and $route) {
    $expiredToken = New-ChallengeToken -PrivateKey $privateKey -Route $route -ExpiresInSeconds 60 -Expired:$true
    Set-Item -Path Env:EXPIRED_TOKEN -Value $expiredToken
    Write-Host "Generated EXPIRED_TOKEN from PRIVATE_KEY + CHALLENGE_ROUTE" -ForegroundColor Green
  }

  if (-not $brokenToken -and $privateKey -and $brokenRoute) {
    $brokenToken = New-ChallengeToken -PrivateKey $privateKey -Route $brokenRoute -ExpiresInSeconds 3600 -Expired:$false
    Set-Item -Path Env:BROKEN_TOKEN -Value $brokenToken
    Write-Host "Generated BROKEN_TOKEN from PRIVATE_KEY + BROKEN_ROUTE" -ForegroundColor Green
  }

  if (-not $invalidToken) {
    Set-Item -Path Env:INVALID_TOKEN -Value "invalid.token"
  }

  $finalValidToken = (Get-Item -Path Env:VALID_TOKEN -ErrorAction SilentlyContinue).Value
  if (-not $finalValidToken) {
    Write-Error "VALID_TOKEN is missing. Set VALID_TOKEN directly or provide PRIVATE_KEY + CHALLENGE_ROUTE in .env"
    exit 1
  }
}

function Run-K6Script {
  param([string]$ScriptName)

  # Env vars are already loaded via Load-EnvFile, so we don't rely on k6 "--env-file"
  $args = @("run", $ScriptName)
  Write-Host "Running: k6 $($args -join ' ') (env loaded from $EnvFile)" -ForegroundColor Cyan
  & k6 @args
  return $LASTEXITCODE
}

function Run-TcpScript {
  param(
    [string]$ScriptName,
    [string[]]$ScriptArgs
  )

  $cmdArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $scriptDir $ScriptName))
  if ($ScriptArgs) {
    $cmdArgs += $ScriptArgs
  }

  Write-Host "Running: powershell $($cmdArgs -join ' ')" -ForegroundColor Cyan
  & powershell @cmdArgs
  return $LASTEXITCODE
}

function Get-EnvOrDefault {
  param(
    [string]$Name,
    [string]$DefaultValue
  )

  $item = Get-Item -Path ("Env:" + $Name) -ErrorAction SilentlyContinue
  if ($item -and -not [string]::IsNullOrWhiteSpace($item.Value)) {
    return $item.Value
  }
  return $DefaultValue
}

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
  Write-Error "k6 is not installed or not in PATH"
  Pop-Location
  exit 1
}

Load-EnvFile -Path $EnvFile
Ensure-TokenVars

$results = @()

$k6Suites = @{
  integration = @(
    'gateway_auth_flow.js',
    'gateway_integration_extended.js',
    'gateway_body_limits.js',
    'gateway_rate_limit.js'
  )
  security = @(
    'gateway_security_negative.js'
  )
  resilience = @(
    'gateway_resilience.js'
  )
  load = @(
    'gateway_passthrough_load.js'
  )
  spike = @(
    'gateway_spike.js'
  )
  soak = @(
    'gateway_soak.js'
  )
  quick = @(
    'gateway_auth_flow.js',
    'gateway_integration_extended.js',
    'gateway_rate_limit.js'
  )
}

$tcpSuites = @(
  @{ Name = 'gateway_tcp_auth.ps1'; Args = @("-GatewayHost", (Get-EnvOrDefault -Name 'TCP_GATEWAY_HOST' -DefaultValue 'localhost'), "-GatewayPort", (Get-EnvOrDefault -Name 'TCP_GATEWAY_PORT' -DefaultValue '1337'), "-ValidToken", (Get-EnvOrDefault -Name 'VALID_TOKEN' -DefaultValue ''), "-InvalidToken", (Get-EnvOrDefault -Name 'INVALID_TOKEN' -DefaultValue 'invalid.token')) },
  @{ Name = 'gateway_tcp_limits.ps1'; Args = @("-GatewayHost", (Get-EnvOrDefault -Name 'TCP_GATEWAY_HOST' -DefaultValue 'localhost'), "-GatewayPort", (Get-EnvOrDefault -Name 'TCP_GATEWAY_PORT' -DefaultValue '1337'), "-ValidToken", (Get-EnvOrDefault -Name 'VALID_TOKEN' -DefaultValue ''), "-ConnectionCount", (Get-EnvOrDefault -Name 'TCP_LIMIT_CONNECTIONS' -DefaultValue '30'), "-HoldMilliseconds", (Get-EnvOrDefault -Name 'TCP_LIMIT_HOLD_MS' -DefaultValue '3000')) }
)

$selectedK6Scripts = @()
$runTcpGroup = $false

switch ($Type) {
  'integration' { $selectedK6Scripts = $k6Suites.integration }
  'security' { $selectedK6Scripts = $k6Suites.security }
  'resilience' { $selectedK6Scripts = $k6Suites.resilience }
  'load' { $selectedK6Scripts = $k6Suites.load }
  'spike' { $selectedK6Scripts = $k6Suites.spike }
  'soak' { $selectedK6Scripts = $k6Suites.soak }
  'tcp' { $runTcpGroup = $true }
  'quick' {
    $selectedK6Scripts = $k6Suites.quick
    $runTcpGroup = -not $SkipTcp
  }
  'all' {
    $selectedK6Scripts += $k6Suites.integration
    $selectedK6Scripts += $k6Suites.security
    $selectedK6Scripts += $k6Suites.resilience
    $selectedK6Scripts += $k6Suites.load
    $selectedK6Scripts += $k6Suites.spike
    if (-not $SkipLongRunning) {
      $selectedK6Scripts += $k6Suites.soak
    }
    $runTcpGroup = -not $SkipTcp
  }
}

if ($Type -eq 'soak' -and $SkipLongRunning) {
  Write-Host "Skipping soak because -SkipLongRunning is set." -ForegroundColor Yellow
}

foreach ($scriptName in $selectedK6Scripts) {
  if ($SkipLongRunning -and $scriptName -eq 'gateway_soak.js') {
    Write-Host "Skipped long-running script: $scriptName" -ForegroundColor Yellow
    continue
  }

  $code = Run-K6Script -ScriptName $scriptName
  $results += [PSCustomObject]@{ Name = $scriptName; ExitCode = $code; Type = 'k6' }

  if ($code -ne 0 -and $StopOnFail) {
    Write-Host "StopOnFail is enabled. Halting after failed script: $scriptName" -ForegroundColor Red
    break
  }
}

if ($runTcpGroup) {
  foreach ($tcpEntry in $tcpSuites) {
    $code = Run-TcpScript -ScriptName $tcpEntry.Name -ScriptArgs $tcpEntry.Args
    $results += [PSCustomObject]@{ Name = $tcpEntry.Name; ExitCode = $code; Type = 'tcp' }

    if ($code -ne 0 -and $StopOnFail) {
      Write-Host "StopOnFail is enabled. Halting after failed script: $($tcpEntry.Name)" -ForegroundColor Red
      break
    }
  }
}

Write-Host "`n========== Gateway Test Summary ==========" -ForegroundColor Cyan
$failCount = 0
foreach ($result in $results) {
  if ($result.ExitCode -eq 0) {
    Write-Host "[PASS][$($result.Type)] $($result.Name)" -ForegroundColor Green
  }
  else {
    Write-Host "[FAIL][$($result.Type)] $($result.Name) (exit=$($result.ExitCode))" -ForegroundColor Red
    $failCount += 1
  }
}

Pop-Location
if ($failCount -gt 0) {
  exit 1
}
exit 0
