param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    [string]$PlantUmlJar = "",

    [Parameter(Mandatory = $false)]
    [switch]$KeepIntermediate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        return (Resolve-Path -LiteralPath $Path).Path
    }
    catch {
        throw "Khong tim thay duong dan: $Path"
    }
}

function Ensure-ParentDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $parent = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($parent)) {
        return
    }

    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Find-PlantUmlJar {
    param(
        [Parameter(Mandatory = $false)]
        [string]$UserProvidedPath
    )

    if (-not [string]::IsNullOrWhiteSpace($UserProvidedPath)) {
        return (Resolve-FullPath -Path $UserProvidedPath)
    }

    # Trong ham, MyInvocation.MyCommand.Path co the null khi chay ham, dung PSScriptRoot neu co.
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
    if (-not $scriptDir) {
        $scriptDir = Get-Location
    }

    $localJar = Join-Path $scriptDir "plantuml.jar"
    if (Test-Path -LiteralPath $localJar) {
        return (Resolve-FullPath -Path $localJar)
    }

    $downloadUrl = "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar"
    Write-Host "Dang tai plantuml.jar tu: $downloadUrl"

    Invoke-WebRequest -Uri $downloadUrl -OutFile $localJar
    return (Resolve-FullPath -Path $localJar)
}

function Ensure-JavaAvailable {
    $javaCmd = Get-Command java -ErrorAction SilentlyContinue
    if (-not $javaCmd) {
        throw "Khong tim thay Java. Hay cai JRE/JDK va dam bao lenh 'java' chay duoc trong PATH."
    }
}

function Convert-PlantUmlToSvg {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InputFile,

        [Parameter(Mandatory = $true)]
        [string]$JarPath,

        [Parameter(Mandatory = $true)]
        [string]$TempDir
    )

    # Dung call operator de bao ve dau cach duong dan co khoang trang
    $javaArgs = @('-jar', $JarPath, '-tsvg', '-o', $TempDir, $InputFile)
    $stdOut = & java @javaArgs 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-Host $stdOut
        throw "PlantUML render that bai. ExitCode=$exitCode"
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($InputFile)
    $svgFile = Join-Path $TempDir "$baseName.svg"

    if (-not (Test-Path -LiteralPath $svgFile)) {
        throw "Khong tim thay file SVG duoc tao: $svgFile"
    }

    return $svgFile
}

function Export-SvgToVsdx {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SvgPath,

        [Parameter(Mandatory = $true)]
        [string]$OutputVsdxPath
    )

    $visio = $null
    $doc = $null

    function Convert-SelectionToEditableShapes {
        param(
            [Parameter(Mandatory = $true)]
            $Window,

            [Parameter(Mandatory = $false)]
            [int]$MaxPasses = 20
        )

        # Ungroup nhieu lan de tach SVG thanh cac shape/co no i de co the tuong tac trong Visio.
        for ($i = 0; $i -lt $MaxPasses; $i++) {
            $Window.DeselectAll() | Out-Null
            $Window.SelectAll() | Out-Null

            try {
                $Window.Selection.Ungroup() | Out-Null
            }
            catch {
                break
            }
        }

        $Window.DeselectAll() | Out-Null
    }

    try {
        $visio = New-Object -ComObject Visio.Application
        $visio.Visible = $false
        $visio.AlertResponse = 7

        $doc = $visio.Documents.Add("")
        $page = $visio.ActivePage
        $importedShape = $page.Import($SvgPath)

        if ($importedShape -ne $null -and $visio.ActiveWindow -ne $null) {
            $visio.ActiveWindow.Select($importedShape, 2) | Out-Null
            Convert-SelectionToEditableShapes -Window $visio.ActiveWindow
        }

        Ensure-ParentDirectory -Path $OutputVsdxPath
        $doc.SaveAs($OutputVsdxPath) | Out-Null
    }
    catch {
        throw "Khong the xuat VSDX qua Visio COM. Dam bao da cai Microsoft Visio desktop. Chi tiet: $($_.Exception.Message)"
    }
    finally {
        if ($doc -ne $null) {
            $doc.Close() | Out-Null
        }

        if ($visio -ne $null) {
            $visio.Quit()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($visio) | Out-Null
        }

        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
}

$resolvedInput = Resolve-FullPath -Path $InputPath

if ([System.IO.Path]::GetExtension($resolvedInput).ToLowerInvariant() -ne ".puml") {
    throw "Input phai la file .puml"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = [System.IO.Path]::ChangeExtension($resolvedInput, ".vsdx")
}
else {
    $outputExt = [System.IO.Path]::GetExtension($OutputPath).ToLowerInvariant()
    if ($outputExt -ne ".vsdx") {
        throw "OutputPath phai co duoi .vsdx"
    }
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)

Ensure-JavaAvailable
$jarPath = Find-PlantUmlJar -UserProvidedPath $PlantUmlJar

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("puml2vsdx_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Write-Host "Input : $resolvedInput"
    Write-Host "Jar   : $jarPath"
    Write-Host "Output: $outputFullPath"

    $svgPath = Convert-PlantUmlToSvg -InputFile $resolvedInput -JarPath $jarPath -TempDir $tempDir
    Export-SvgToVsdx -SvgPath $svgPath -OutputVsdxPath $outputFullPath

    Write-Host "Thanh cong: $outputFullPath"
}
finally {
    if ($KeepIntermediate) {
        Write-Host "Giu lai file tam tai: $tempDir"
    }
    elseif (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
