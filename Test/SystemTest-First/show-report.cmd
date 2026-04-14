@echo off
REM wrapper around playwright show-report to avoid port conflicts.
REM Usage: run from this directory. Optionally specify port number.

set PORT=%1



npx playwright show-report playwright-report --port=%PORT%nif "%PORT%"=="" set PORT=0