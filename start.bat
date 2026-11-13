@echo off
rem Starts Parley (API + web app). Double-click, or run  start.bat -Lan  to also allow other PCs on your network.
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "scripts\dev.ps1" %*
echo.
pause
