# ============================================================
# FCTF - SonarQube Full Scan Script (tất cả projects)
# Chạy: .\scan-all.ps1 -Token "sqa_75c9fd20305461620bb6fbc3dbdfc881941ff49d"
# ============================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$SONAR_URL = "http://localhost:9000"
$Root = $PSScriptRoot
$Results = @()

function Print-Header {
    param([string]$Name)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " Scanning: $Name" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Record-Result {
    param([string]$Name, [bool]$Ok)
    $script:Results += [PSCustomObject]@{ Project = $Name; Status = if ($Ok) { "OK" } else { "FAIL" } }
    if ($Ok) {
        Write-Host "[OK] $Name scan completed" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $Name scan failed" -ForegroundColor Red
    }
}

# ─── 1. ControlCenterAndChallengeHostingServer (.NET solution) ────────────────
Print-Header "FCTF-ControlCenter (.NET)"
Push-Location "$Root\ControlCenterAndChallengeHostingServer"
dotnet sonarscanner begin /k:"FCTF-ControlCenter" /n:"FCTF Control Center (.NET)" /d:sonar.host.url="$SONAR_URL" /d:sonar.token="$Token"
dotnet build
dotnet sonarscanner end /d:sonar.token="$Token"
Record-Result "FCTF-ControlCenter (.NET)" ($LASTEXITCODE -eq 0)
Pop-Location

# ─── 2. ContestantPortal (TypeScript / React / Vite) ─────────────────────────
Print-Header "FCTF-ContestantPortal (TypeScript)"
Push-Location "$Root\ContestantPortal"
sonar-scanner "-Dsonar.token=$Token"
Record-Result "FCTF-ContestantPortal (TypeScript)" ($LASTEXITCODE -eq 0)
Pop-Location

# ─── 3. ManagementPlatform (Python / Flask) ──────────────────────────────────
Print-Header "FCTF-ManagementPlatform (Python)"
Push-Location "$Root\FCTF-ManagementPlatform"
sonar-scanner "-Dsonar.token=$Token" "-Dsonar.python.version=3"
Record-Result "FCTF-ManagementPlatform (Python)" ($LASTEXITCODE -eq 0)
Pop-Location

# ─── 4. ChallengeGateway (Go) ────────────────────────────────────────────────
Print-Header "FCTF-ChallengeGateway (Go)"
Push-Location "$Root\ChallengeGateway"
sonar-scanner "-Dsonar.token=$Token"
Record-Result "FCTF-ChallengeGateway (Go)" ($LASTEXITCODE -eq 0)
Pop-Location

# ─── Summary ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============ SUMMARY ============" -ForegroundColor Yellow
$Results | Format-Table -AutoSize
Write-Host "View results at: $SONAR_URL/projects" -ForegroundColor Yellow

# cd "d:\Semester 9\FCTF-Clone\FCTF"
.\scan-all.ps1 -Token "sqa_75c9fd20305461620bb6fbc3dbdfc881941ff49d"