param(
  [Parameter(Mandatory = $false)]
  [string]$EnvFile,
  [Parameter(Mandatory = $false)]
  [switch]$Strict,
  [Parameter(Mandatory = $false)]
  [switch]$StopOnFail = $true
)

# Resolve paths relative to this script's directory so runners keep working after folder moves
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $EnvFile) { $EnvFile = Join-Path $scriptDir ".env" }

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

    Set-Item -Path ("env:" + $name) -Value $value
  }
}

Load-EnvFile -Path $EnvFile

if ($Strict) {
  $env:STRICT = "true"
}

$tokensTxt = Join-Path $scriptDir "tokens.txt"
$tokensCsv = Join-Path $scriptDir "tokens.csv"
$tokenTxt = Join-Path $scriptDir "token.txt"
$tokenCsv = Join-Path $scriptDir "token.csv"

# If TOKEN_LIST isn't set or is empty, point TOKEN_FILE at the tokens TXT/CSV file instead of creating a huge env var
$tokenListItem = Get-Item -Path Env:TOKEN_LIST -ErrorAction SilentlyContinue
if (-not $tokenListItem -or [string]::IsNullOrEmpty($tokenListItem.Value)) {
  # Prefer newline-based lists
  if (Test-Path $tokensTxt) {
    $p = (Resolve-Path $tokensTxt).Path
    Set-Item -Path "env:TOKEN_FILE" -Value $p
    $count = (Get-Content $p | Where-Object { $_.Trim() -ne "" }).Count
    Write-Host "Auto-loaded tokens from $p (count=$count)"
  } elseif (Test-Path $tokenTxt) {
    $p = (Resolve-Path $tokenTxt).Path
    Set-Item -Path "env:TOKEN_FILE" -Value $p
    $count = (Get-Content $p | Where-Object { $_.Trim() -ne "" }).Count
    Write-Host "Auto-loaded tokens from $p (count=$count)"
  } elseif (Test-Path $tokensCsv) {
    $p = (Resolve-Path $tokensCsv).Path
    Set-Item -Path "env:TOKEN_FILE" -Value $p
    $content = (Get-Content $p -Raw)
    $count = ($content.Split(',') | Where-Object { $_.Trim() -ne "" }).Count
    Write-Host "Auto-loaded tokens from $p (count=$count)"
  } elseif (Test-Path $tokenCsv) {
    $p = (Resolve-Path $tokenCsv).Path
    Set-Item -Path "env:TOKEN_FILE" -Value $p
    $content = (Get-Content $p -Raw)
    $count = ($content.Split(',') | Where-Object { $_.Trim() -ne "" }).Count
    Write-Host "Auto-loaded tokens from $p (count=$count)"
  }

  # If a single-token env variable is required by some scripts, set TOKEN to the first token found
  if (-not (Get-Item -Path Env:TOKEN -ErrorAction SilentlyContinue) -and (Get-Item -Path Env:TOKEN_FILE -ErrorAction SilentlyContinue)) {
    $tokenFilePath = (Get-Item -Path Env:TOKEN_FILE).Value
    if (Test-Path $tokenFilePath) {
      $raw = Get-Content $tokenFilePath -Raw
      $first = $null
      if ($raw -match ",") { $first = ($raw.Split(',') | Where-Object { $_.Trim() -ne "" })[0] }
      else { $first = (Get-Content $tokenFilePath | Where-Object { $_.Trim() -ne "" })[0] }
      if ($first) {
        Set-Item -Path "env:TOKEN" -Value $first
        Write-Host "Set TOKEN to first token from $tokenFilePath"
      }
    }
  }
}

# --- Token allocation across scripts ---
# Load tokens into an array for per-script allocation
$allTokens = @()
$tokenFileItem = Get-Item -Path Env:TOKEN_FILE -ErrorAction SilentlyContinue
if ($tokenFileItem -and (Test-Path $tokenFileItem.Value)) {
  $tf = $tokenFileItem.Value
  if ($tf.ToLower().EndsWith('.csv')) {
    $content = Get-Content $tf -Raw
    $allTokens = $content.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
  } else {
    $allTokens = Get-Content $tf | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
  }
} elseif (Get-Item -Path Env:TOKEN_LIST -ErrorAction SilentlyContinue) {
  $content = (Get-Item -Path Env:TOKEN_LIST).Value
  $allTokens = $content.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
} elseif (Get-Item -Path Env:TOKEN -ErrorAction SilentlyContinue) {
  $allTokens = @((Get-Item -Path Env:TOKEN).Value)
}

$tokenIndex = 0
$singleTokenScripts = @('concurrent_hint_unlock.js', 'concurrent_cooldown_attempts.js', 'concurrent_correct_submissions.js')

function AllocateTokensForScript {
  param([string]$ScriptName)
  if ($allTokens.Count -eq 0) { return }

  if ($singleTokenScripts -contains $ScriptName) {
    # Assign one token per script (sequentially)
    if ($tokenIndex -ge $allTokens.Count) {
      Write-Host "WARNING: Not enough tokens; reusing tokens from start"
    }
    $idx = $tokenIndex % $allTokens.Count
    Set-Item -Path "env:TOKEN" -Value $allTokens[$idx]
    Write-Host "Assigned TOKEN (index=$($idx+1)) for $ScriptName"
    $tokenIndex += 1
  } elseif ($ScriptName -eq 'concurrent_dynamic_recalc.js') {
    # Allocate a slice of tokens for multi-team test based on CONCURRENCY
    $concurrency = (Get-Item -Path Env:CONCURRENCY -ErrorAction SilentlyContinue).Value
    if (-not $concurrency) { $concurrency = 10 }
    $needed = [int]$concurrency
    $remaining = $allTokens.Count - $tokenIndex
    if ($remaining -lt $needed) {
      Write-Host "WARNING: Not enough tokens for dynamic test (need $needed, have $remaining). Using all remaining ($remaining)."
      $endIndex = $allTokens.Count - 1
    } else {
      $endIndex = $tokenIndex + $needed - 1
    }
    $slice = if ($tokenIndex -le $endIndex) { $allTokens[$tokenIndex..$endIndex] } else { @() }
    if ($slice.Count -eq 0) { Write-Host "WARNING: No tokens available for dynamic test"; return }
    $tmpPath = Join-Path $scriptDir ("token_slice_$(Get-Date -Format 'yyyyMMddHHmmss').txt")
    $slice | Out-File -FilePath $tmpPath -Encoding ASCII
    Set-Item -Path "env:TOKEN_FILE" -Value (Resolve-Path $tmpPath).Path
    Set-Item -Path "env:TOKEN" -Value $slice[0]
    Write-Host "Assigned TOKEN_FILE for dynamic test: $tmpPath (count=$($slice.Count))"
    $tokenIndex = $endIndex + 1
    # Remember temp path for cleanup after run
    if (-not (Get-Variable -Name 'TempTokenFiles' -ErrorAction SilentlyContinue)) { $TempTokenFiles = @() }
    $TempTokenFiles += $tmpPath
  }
}

$tests = @(
  'concurrent_hint_unlock.js',
  'concurrent_cooldown_attempts.js',
  'concurrent_correct_submissions.js',
  "concurrent_dynamic_recalc.js"
)

$results = @()

function Validate-ScriptEnv {
  param([string]$ScriptName, [ref]$Reason)

  # Helper to check if an env var exists and is non-empty
  function HasEnv($n) {
    $it = Get-Item -Path ("env:" + $n) -ErrorAction SilentlyContinue
    return $it -and -not [string]::IsNullOrEmpty($it.Value)
  }

  # Auth check: TOKEN or TOKEN_LIST or TOKEN_FILE or (USERNAME & PASSWORD)
  $hasAuth = HasEnv('TOKEN') -or HasEnv('TOKEN_LIST') -or HasEnv('TOKEN_FILE') -or (HasEnv('USERNAME') -and HasEnv('PASSWORD'))

  switch ($ScriptName) {
    'concurrent_correct_submissions.js' {
      if (-not (HasEnv 'CHALLENGE_ID') -or -not (HasEnv 'CHALLENGE_FLAG')) { $Reason.Value = 'CHALLENGE_ID and CHALLENGE_FLAG are required'; return $false }
      if (-not $hasAuth) { $Reason.Value = 'Authentication required: set TOKEN or USERNAME+PASSWORD or generate tokens'; return $false }
      return $true
    }
    'concurrent_hint_unlock.js' {
      if (-not (HasEnv 'HINT_ID')) { $Reason.Value = 'HINT_ID is required'; return $false }
      if (-not $hasAuth) { $Reason.Value = 'Authentication required: set TOKEN or USERNAME+PASSWORD or generate tokens'; return $false }
      return $true
    }
    'concurrent_cooldown_attempts.js' {
      if (-not (HasEnv 'CHALLENGE_ID') -or -not (HasEnv 'WRONG_FLAG')) { $Reason.Value = 'CHALLENGE_ID and WRONG_FLAG are required'; return $false }
      if (-not $hasAuth) { $Reason.Value = 'Authentication required: set TOKEN or USERNAME+PASSWORD or generate tokens'; return $false }
      return $true
    }
    'concurrent_dynamic_recalc.js' {
      if (-not (HasEnv 'CHALLENGE_ID') -or -not (HasEnv 'CHALLENGE_FLAG')) { $Reason.Value = 'CHALLENGE_ID and CHALLENGE_FLAG are required'; return $false }
      if (-not (HasEnv 'CHALLENGE_CATEGORY')) { $Reason.Value = 'CHALLENGE_CATEGORY is required'; return $false }
      if (-not $hasAuth) { $Reason.Value = 'Authentication required: set TOKEN_LIST / TOKEN_FILE or USERNAME+PASSWORD or generate tokens'; return $false }
      return $true
    }
    default {
      return $true
    }
  }
}

foreach ($script in $tests) {
  $scriptPath = Join-Path $scriptDir $script
    $results += [PSCustomObject]@{ Script = $script; Status = "FAIL"; Reason = "missing script" }
    if ($StopOnFail) { break }
    continue
  }

  # Validate envs for this script before running
  $reasonRef = ''
  if (-not (Validate-ScriptEnv -ScriptName $script -Reason ([ref]$reasonRef))) {
    $results += [PSCustomObject]@{ Script = $script; Status = "FAIL"; Reason = $reasonRef }
    Write-Host ("Skipping {0}: {1}" -f $script, $reasonRef)
    if ($StopOnFail) { break }
    continue
  }

  # Allocate tokens for this script (single-token scripts use one token; dynamic re-calculation uses a token slice)
  AllocateTokensForScript -ScriptName $script

  # Preflight API checks using TOKEN to ensure the target exists and is accessible
  function PreflightCheck($scriptName, [ref]$Reason) {
    $base = (Get-Item -Path Env:BASE_URL -ErrorAction SilentlyContinue).Value
    if (-not $base) { $base = 'http://localhost:5000' }
    $tokenItem = Get-Item -Path Env:TOKEN -ErrorAction SilentlyContinue
    if (-not $tokenItem) { $Reason.Value = 'TOKEN not set (first token not available)'; return $false }
    $token = $tokenItem.Value

    try {
      # Check user profile to validate token
      $h = @{ Authorization = "Bearer $token" }
      $profile = Invoke-RestMethod -Method Get -Uri ("$base/api/Users/profile") -Headers $h -ErrorAction Stop
    } catch {
      $Reason.Value = "Token test failed: $($_.Exception.Message)"; return $false
    }

    switch ($scriptName) {
      'concurrent_correct_submissions.js' {
        $challengeId = (Get-Item -Path Env:CHALLENGE_ID -ErrorAction SilentlyContinue).Value
        if (-not $challengeId) { $Reason.Value = 'CHALLENGE_ID not set'; return $false }
        try {
          $res = Invoke-RestMethod -Method Get -Uri ("$base/api/Challenge/$challengeId") -Headers $h -ErrorAction Stop
          # Check if response has data (API returns message:true and data:{...})
          if ($res -and $res.data) {
            $chal = $res.data
            if ($chal.state -eq 'hidden' -or $chal.state -eq 'locked') {
              $Reason.Value = "Challenge not available (state=$($chal.state))"
              return $false
            }
          } else {
            $Reason.Value = "Challenge lookup returned unexpected structure (no data field)"
            return $false
          }
        } catch {
          $err = $_.Exception.Message
          $inner = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { '' }
          $Reason.Value = "Challenge lookup failed: $err $inner"; return $false
        }
        return $true
      }
      'concurrent_hint_unlock.js' {
        $hintId = (Get-Item -Path Env:HINT_ID -ErrorAction SilentlyContinue).Value
        if (-not $hintId) { $Reason.Value = 'HINT_ID not set'; return $false }
        try {
          $res = Invoke-RestMethod -Method Get -Uri ("$base/api/Hint/$hintId") -Headers $h -ErrorAction Stop
        } catch {
          $Reason.Value = "Hint lookup failed: $($_.Exception.Message)"; return $false
        }
        return $true
      }
      'concurrent_cooldown_attempts.js' {
        $challengeId = (Get-Item -Path Env:CHALLENGE_ID -ErrorAction SilentlyContinue).Value
        if (-not $challengeId) { $Reason.Value = 'CHALLENGE_ID not set'; return $false }
        try {
          $res = Invoke-RestMethod -Method Get -Uri ("$base/api/Challenge/$challengeId") -Headers $h -ErrorAction Stop
          if (-not $res.data) { $Reason.Value = 'Challenge response missing data field'; return $false }
        } catch {
          $Reason.Value = "Challenge lookup failed: $($_.Exception.Message)"; return $false
        }
        return $true
      }
      'concurrent_dynamic_recalc.js' {
        $challengeId = (Get-Item -Path Env:CHALLENGE_ID -ErrorAction SilentlyContinue).Value
        if (-not $challengeId) { $Reason.Value = 'CHALLENGE_ID not set'; return $false }
        try {
          $res = Invoke-RestMethod -Method Get -Uri ("$base/api/Challenge/$challengeId") -Headers $h -ErrorAction Stop
          if (-not $res.data) { $Reason.Value = 'Challenge response missing data field'; return $false }
          $type = $res.data.type
          if ($type -ne 'dynamic') { $Reason.Value = "Challenge is not dynamic (type=$type)"; return $false }
        } catch {
          $Reason.Value = "Challenge lookup failed: $($_.Exception.Message)"; return $false
        }
        return $true
      }
      default { return $true }
    }
  }

  $pfReason = ''
  if (-not (PreflightCheck -scriptName $script -Reason ([ref]$pfReason))) {
    $results += [PSCustomObject]@{ Script = $script; Status = "FAIL"; Reason = $pfReason }
    Write-Host ("Skipping {0}: {1}" -f $script, $pfReason)
    if ($StopOnFail) { break }
    continue
  }

  if ($script -eq "concurrent_dynamic_recalc.js" -and $env:STRICT -eq "true") {
    $required = @("DYN_FUNCTION", "DYN_INITIAL", "DYN_DECAY", "DYN_MINIMUM", "DYN_EXPECTED_SOLVE_COUNT", "CHALLENGE_CATEGORY")
    $missing = @()
    foreach ($r in $required) {
      $item = Get-Item -Path ("env:" + $r) -ErrorAction SilentlyContinue
      if (-not $item -or [string]::IsNullOrEmpty($item.Value)) {
        $missing += $r
      }
    }
    if ($missing.Count -gt 0) {
      $results += [PSCustomObject]@{ Script = $script; Status = "FAIL"; Reason = "missing env: $($missing -join ', ')" }
      if ($StopOnFail) { break }
      continue
    }
  }

  Write-Host "Running $scriptPath"
  $output = & k6 run $scriptPath 2>&1 | Out-String
  $exitCode = $LASTEXITCODE

  $failedByOutput = $false
  if ($output -match "STRICT check failed") { $failedByOutput = $true }
  if ($output -match "Dynamic value mismatch") { $failedByOutput = $true }
  if ($output -match "Unable to fetch challenge value") { $failedByOutput = $true }

  if ($exitCode -ne 0 -or $failedByOutput) {
    if ($exitCode -ne 0) { $reason = "k6 exit code $exitCode" } else { $reason = "summary indicates failure" }
    $results += [PSCustomObject]@{ Script = $script; Status = "FAIL"; Reason = $reason }
    Write-Host $output
    if ($StopOnFail) { break }
  } else {
    $results += [PSCustomObject]@{ Script = $script; Status = "PASS"; Reason = "" }
    Write-Host $output
  }

  # Cleanup any temp token files created for multi-token tests
  if ($script -eq 'concurrent_dynamic_recalc.js' -and (Get-Variable -Name 'TempTokenFiles' -ErrorAction SilentlyContinue)) {
    foreach ($f in $TempTokenFiles) {
      if (Test-Path $f) {
        try { Remove-Item $f -Force -ErrorAction SilentlyContinue; Write-Host "Removed temp token file: $f" } catch { }
      }
    }
    Remove-Variable -Name TempTokenFiles -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Batch summary"
$results | ForEach-Object {
  if ($_.Status -eq "PASS") {
    Write-Host "PASS - $($_.Script)"
  } else {
    Write-Host "FAIL - $($_.Script) :: $($_.Reason)"
  }
}

$hasFail = $results | Where-Object { $_.Status -eq "FAIL" }
if ($hasFail) { exit 1 }
exit 0
