@echo off
REM Wrapper de chay script PowerShell tu CMD.
REM Cach dung: plantuml2vsdx.bat "D:\...\sample.puml" "D:\...\sample.vsdx"

if "%1"=="" (
  echo Usage: %~nx0 "InputFile.puml" [OutputFile.vsdx]
  exit /b 1
)

set "INPUT=%~1"
if "%2"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-plantuml-to-visio.ps1" -InputPath "%INPUT%"
) else (
  set "OUTPUT=%~2"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-plantuml-to-visio.ps1" -InputPath "%INPUT%" -OutputPath "%OUTPUT%"
)
