@echo off
rem One-time setup on a new PC: Python/Node packages, widget build, MySQL database + .env, migrations.
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "scripts\setup.ps1" %*
echo.
pause
