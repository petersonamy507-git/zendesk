@echo off
rem Stops Parley (only Parley's own processes; other programs are never touched).
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-dev.ps1" %*
echo.
pause
