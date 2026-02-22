param(
  [Parameter(Mandatory = $true)]
  [string]$PrivateKey,

  [Parameter(Mandatory = $true)]
  [string]$Route,

  [Parameter(Mandatory = $false)]
  [int]$ExpiresInSeconds = 3600,

  [Parameter(Mandatory = $false)]
  [switch]$Expired
)

function ConvertTo-Base64UrlNoPadding {
  param([byte[]]$Bytes)
  $base64 = [System.Convert]::ToBase64String($Bytes)
  return $base64.TrimEnd('=') -replace '\+', '-' -replace '/', '_'
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
$payloadB64 = ConvertTo-Base64UrlNoPadding -Bytes ([System.Text.Encoding]::UTF8.GetBytes($payloadJson))

$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($PrivateKey))
try {
  $signatureBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payloadB64))
}
finally {
  $hmac.Dispose()
}

$sigB64 = ConvertTo-Base64UrlNoPadding -Bytes $signatureBytes
$token = "$payloadB64.$sigB64"

Write-Output $token
