param(
  [Parameter(Mandatory = $false)]
  [string]$GatewayHost = "localhost",

  [Parameter(Mandatory = $false)]
  [int]$GatewayPort = 1337,

  [Parameter(Mandatory = $true)]
  [string]$ValidToken,

  [Parameter(Mandatory = $false)]
  [int]$ConnectionCount = 30,

  [Parameter(Mandatory = $false)]
  [int]$HoldMilliseconds = 3000,

  [Parameter(Mandatory = $false)]
  [int]$ReadTimeoutMs = 3000
)

$jobs = @()
for ($i = 1; $i -le $ConnectionCount; $i++) {
  $jobs += Start-Job -ScriptBlock {
    param($h, $p, $t, $hold, $timeout)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $connectTask = $client.ConnectAsync($h, $p)
      if (-not $connectTask.Wait($timeout)) {
        return [PSCustomObject]@{ Success = $false; Status = 'connect_timeout'; Output = '' }
      }

      $stream = $client.GetStream()
      $stream.ReadTimeout = $timeout
      $stream.WriteTimeout = $timeout

      $reader = New-Object System.IO.StreamReader($stream)
      $writer = New-Object System.IO.StreamWriter($stream)
      $writer.AutoFlush = $true

      Start-Sleep -Milliseconds 100
      $writer.WriteLine($t)
      Start-Sleep -Milliseconds 200

      $buffer = New-Object char[] 4096
      $outBuilder = New-Object System.Text.StringBuilder
      while ($stream.DataAvailable) {
        $n = $reader.Read($buffer, 0, $buffer.Length)
        if ($n -le 0) { break }
        [void]$outBuilder.Append($buffer, 0, $n)
        Start-Sleep -Milliseconds 20
      }

      $text = $outBuilder.ToString()
      Start-Sleep -Milliseconds $hold

      if ($text -match 'Too many connections for token') {
        return [PSCustomObject]@{ Success = $true; Status = 'token_limited'; Output = $text }
      }
      if ($text -match 'Access Granted') {
        return [PSCustomObject]@{ Success = $true; Status = 'granted'; Output = $text }
      }
      if ($text -match 'Auth failed') {
        return [PSCustomObject]@{ Success = $true; Status = 'auth_failed'; Output = $text }
      }

      return [PSCustomObject]@{ Success = $true; Status = 'other'; Output = $text }
    }
    catch {
      return [PSCustomObject]@{ Success = $false; Status = 'exception'; Output = $_.Exception.Message }
    }
    finally {
      if ($client) { $client.Close() }
    }
  } -ArgumentList $GatewayHost, $GatewayPort, $ValidToken, $HoldMilliseconds, $ReadTimeoutMs
}

$results = Receive-Job -Job $jobs -Wait -AutoRemoveJob

$granted = ($results | Where-Object { $_.Status -eq 'granted' }).Count
$limited = ($results | Where-Object { $_.Status -eq 'token_limited' }).Count
$authFailed = ($results | Where-Object { $_.Status -eq 'auth_failed' }).Count
$other = ($results | Where-Object { $_.Status -eq 'other' }).Count
$exceptions = ($results | Where-Object { $_.Success -eq $false }).Count

Write-Host "TCP limits summary: granted=$granted limited=$limited auth_failed=$authFailed other=$other exceptions=$exceptions"

if ($exceptions -gt 0) {
  Write-Host "FAIL: unexpected TCP client exceptions occurred." -ForegroundColor Red
  exit 1
}

if ($limited -lt 1) {
  Write-Host "WARNING: no token limit observed. Increase ConnectionCount or lower TCP_MAX_CONNS_PER_TOKEN to validate this control." -ForegroundColor Yellow
}

if ($granted -lt 1) {
  Write-Host "FAIL: no granted TCP connection observed with valid token." -ForegroundColor Red
  exit 1
}

Write-Host "TCP limits test completed." -ForegroundColor Green
exit 0
