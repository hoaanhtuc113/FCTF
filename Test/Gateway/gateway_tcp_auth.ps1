param(
  [Parameter(Mandatory = $false)]
  [string]$GatewayHost = "localhost",

  [Parameter(Mandatory = $false)]
  [int]$GatewayPort = 1337,

  [Parameter(Mandatory = $false)]
  [string]$ValidToken,

  [Parameter(Mandatory = $false)]
  [string]$InvalidToken = "invalid.token",

  [Parameter(Mandatory = $false)]
  [int]$ConnectTimeoutMs = 5000,

  [Parameter(Mandatory = $false)]
  [int]$ReadTimeoutMs = 5000
)

function Invoke-TcpAuthProbe {
  param(
    [string]$Host,
    [int]$Port,
    [string]$TokenToSend,
    [int]$ConnectTimeout,
    [int]$ReadTimeout
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connectTask = $client.ConnectAsync($Host, $Port)
    if (-not $connectTask.Wait($ConnectTimeout)) {
      throw "Connect timeout after ${ConnectTimeout}ms"
    }

    $stream = $client.GetStream()
    $stream.ReadTimeout = $ReadTimeout
    $stream.WriteTimeout = $ReadTimeout

    $reader = New-Object System.IO.StreamReader($stream)
    $writer = New-Object System.IO.StreamWriter($stream)
    $writer.AutoFlush = $true

    Start-Sleep -Milliseconds 150

    $writer.WriteLine($TokenToSend)

    Start-Sleep -Milliseconds 200
    $buffer = New-Object char[] 8192
    $outputBuilder = New-Object System.Text.StringBuilder

    while ($stream.DataAvailable) {
      $readCount = $reader.Read($buffer, 0, $buffer.Length)
      if ($readCount -le 0) { break }
      [void]$outputBuilder.Append($buffer, 0, $readCount)
      Start-Sleep -Milliseconds 50
    }

    [PSCustomObject]@{
      Success = $true
      Output = $outputBuilder.ToString()
      Error = ""
    }
  }
  catch {
    [PSCustomObject]@{
      Success = $false
      Output = ""
      Error = $_.Exception.Message
    }
  }
  finally {
    if ($client) { $client.Close() }
  }
}

if (-not $ValidToken) {
  Write-Host "WARNING: ValidToken is empty, valid-token TCP test will be skipped." -ForegroundColor Yellow
}

Write-Host "== TCP Auth Smoke: empty token should fail ==" -ForegroundColor Cyan
$emptyResult = Invoke-TcpAuthProbe -Host $GatewayHost -Port $GatewayPort -TokenToSend "" -ConnectTimeout $ConnectTimeoutMs -ReadTimeout $ReadTimeoutMs
if (-not $emptyResult.Success -or ($emptyResult.Output -notmatch "Auth failed")) {
  Write-Host "FAIL: empty token test did not return expected auth failure." -ForegroundColor Red
  if ($emptyResult.Error) { Write-Host "Error: $($emptyResult.Error)" -ForegroundColor DarkYellow }
  if ($emptyResult.Output) { Write-Host $emptyResult.Output }
  exit 1
}
Write-Host "PASS: empty token rejected." -ForegroundColor Green

Write-Host "== TCP Auth Smoke: invalid token should fail ==" -ForegroundColor Cyan
$invalidResult = Invoke-TcpAuthProbe -Host $GatewayHost -Port $GatewayPort -TokenToSend $InvalidToken -ConnectTimeout $ConnectTimeoutMs -ReadTimeout $ReadTimeoutMs
if (-not $invalidResult.Success -or ($invalidResult.Output -notmatch "Auth failed")) {
  Write-Host "FAIL: invalid token test did not return expected auth failure." -ForegroundColor Red
  if ($invalidResult.Error) { Write-Host "Error: $($invalidResult.Error)" -ForegroundColor DarkYellow }
  if ($invalidResult.Output) { Write-Host $invalidResult.Output }
  exit 1
}
Write-Host "PASS: invalid token rejected." -ForegroundColor Green

if ($ValidToken) {
  Write-Host "== TCP Auth Smoke: valid token should pass auth ==" -ForegroundColor Cyan
  $validResult = Invoke-TcpAuthProbe -Host $GatewayHost -Port $GatewayPort -TokenToSend $ValidToken -ConnectTimeout $ConnectTimeoutMs -ReadTimeout $ReadTimeoutMs
  if (-not $validResult.Success -or ($validResult.Output -notmatch "Access Granted")) {
    Write-Host "FAIL: valid token test did not pass auth." -ForegroundColor Red
    if ($validResult.Error) { Write-Host "Error: $($validResult.Error)" -ForegroundColor DarkYellow }
    if ($validResult.Output) { Write-Host $validResult.Output }
    exit 1
  }
  Write-Host "PASS: valid token authenticated." -ForegroundColor Green
}

Write-Host "TCP auth smoke completed." -ForegroundColor Green
exit 0
