<#
.SYNOPSIS
  One-time setup of Parley on a Windows PC (also safe to re-run).

.DESCRIPTION
  1. checks Python 3.12+, Node.js 20+ and that MySQL 8 answers on its port
  2. creates backend\.venv and installs the exact Python packages from requirements.lock
  3. installs the frontend + widget packages and builds the chat widget
  4. creates the MySQL databases and a least-privilege app user, and writes backend\.env
     (asks for the MySQL admin password once; it is not stored; skipped when backend\.env already exists)
  5. applies the database migrations
  Then start the app with:  scripts\dev.ps1   (or double-click start.bat)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -DbHost 127.0.0.1 -AdminUser root -DbName helpdesk
#>
[CmdletBinding()]
param(
    [string]$DbHost = '127.0.0.1',
    [int]$DbPort = 3306,
    [string]$AdminUser = 'root',
    [string]$DbName = 'helpdesk',
    [string]$DbUser = 'helpdesk',
    [switch]$SkipDatabase
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root     = $script:RepoRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$widget   = Join-Path $root 'widget'
$venvPy   = Join-Path $backend '.venv\Scripts\python.exe'
$envFile  = Join-Path $backend '.env'

function Find-Python {
    foreach ($c in @(@('py', '-3.13'), @('py', '-3.12'), @('python'), @('python3'))) {
        if ($null -eq (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
        $extra = @()
        if ($c.Count -gt 1) { $extra = @($c[1..($c.Count - 1)]) }
        $r = Invoke-Native $c[0] ($extra + @('-c', "import sys; print('%d.%d' % sys.version_info[:2])")) $root
        if ($r.Code -eq 0 -and $r.Output -match '^3\.(\d+)$' -and [int]$Matches[1] -ge 12) {
            return [pscustomobject]@{ File = $c[0]; Prefix = $extra; Version = $r.Output }
        }
    }
    return $null
}

function Test-TcpPort([string]$HostName, [int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        return ($iar.AsyncWaitHandle.WaitOne(2500) -and $client.Connected)
    } catch { return $false } finally { $client.Close() }
}

# ---------------------------------------------------------------- prerequisites
Write-Step "Checking prerequisites"
$py = Find-Python
if ($null -eq $py) { Stop-Fail "Python 3.12 or newer was not found. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and open a new terminal." }
Write-Ok "Python $($py.Version)"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $node -or $null -eq $npm) { Stop-Fail "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org and open a new terminal." }
$nodeVersion = (Invoke-Native $node.Source @('--version') $root).Output.Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) { Stop-Fail "Node.js $nodeVersion is too old; version 20 or newer is required." }
Write-Ok "Node.js $nodeVersion"

if (-not $SkipDatabase -and -not (Test-Path $envFile)) {
    if (-not (Test-TcpPort $DbHost $DbPort)) { Stop-Fail "MySQL is not answering at ${DbHost}:$DbPort. Install MySQL 8 (https://dev.mysql.com/downloads/mysql/) and make sure the service is running, then run this again." }
    Write-Ok "MySQL answers at ${DbHost}:$DbPort"
}

# ---------------------------------------------------------------- backend packages
Write-Step "Setting up the backend (Python packages)"
if (-not (Test-Path $venvPy)) {
    $r = Invoke-Native $py.File ($py.Prefix + @('-m', 'venv', (Join-Path $backend '.venv'))) $root
    if ($r.Code -ne 0) { Write-Host $r.Output; Stop-Fail "Could not create the Python virtual environment." }
    Write-Ok "created backend\.venv"
} else { Write-Ok "backend\.venv already exists" }
Write-Host "    installing packages (this can take a minute)..."
$pip = Invoke-Native $venvPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', 'requirements.txt', '-c', 'requirements.lock') $backend
if ($pip.Code -ne 0) { Write-Host $pip.Output; Stop-Fail "Installing the Python packages failed." }
Write-Ok "Python packages installed (versions pinned by requirements.lock)"

# ---------------------------------------------------------------- frontend + widget
foreach ($app in @(@{ Name = 'frontend'; Dir = $frontend }, @{ Name = 'widget'; Dir = $widget })) {
    Write-Step "Installing $($app.Name) packages"
    $hasLock = Test-Path (Join-Path $app.Dir 'package-lock.json')
    $verb = 'install'
    if ($hasLock) { $verb = 'ci' }
    $r = Invoke-Native $npm.Source @($verb, '--no-audit', '--no-fund') $app.Dir
    if ($r.Code -ne 0 -and $hasLock) {
        Write-Note "npm ci failed; trying npm install"
        $r = Invoke-Native $npm.Source @('install', '--no-audit', '--no-fund') $app.Dir
    }
    if ($r.Code -ne 0) { Write-Host $r.Output; Stop-Fail "Installing the $($app.Name) packages failed." }
    Write-Ok "$($app.Name) packages installed"
}

Write-Step "Building the chat widget"
$r = Invoke-Native $npm.Source @('run', 'build') $widget
if ($r.Code -ne 0) { Write-Host $r.Output; Stop-Fail "Building the widget failed." }
Write-Ok "widget built into frontend\public\widget"

# ---------------------------------------------------------------- database + .env
if ($SkipDatabase) {
    Write-Note "Skipping the database step (-SkipDatabase)."
} elseif (Test-Path $envFile) {
    Write-Step "Database"
    Write-Ok "backend\.env already exists; database setup left alone"
} else {
    Write-Step "Creating the MySQL databases and the app user"
    $preset = [bool]$env:MYSQL_ADMIN_PASSWORD
    if (-not $preset) {
        $secure = Read-Host "Enter the MySQL '$AdminUser' password (hidden; used once for setup and never stored)" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:MYSQL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    try {
        $db = Invoke-Native $venvPy @('-I', (Join-Path $PSScriptRoot 'setup_database.py'), '--host', $DbHost, '--port', "$DbPort", '--admin-user', $AdminUser,
                                      '--db', $DbName, '--app-user', $DbUser, '--env-file', $envFile, '--env-example', (Join-Path $backend '.env.example')) $root
    } finally {
        if (-not $preset) { Remove-Item Env:MYSQL_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
    }
    Write-Host $db.Output
    if ($db.Code -ne 0) { Stop-Fail "Database setup did not finish (see above)." }
}

# ---------------------------------------------------------------- migrations
if (Test-Path $envFile) {
    Write-Step "Applying database migrations"
    Clear-ConflictingEnv
    $mig = Invoke-Native $venvPy @('-m', 'alembic', 'upgrade', 'head') $backend
    if ($mig.Code -ne 0) { Write-Host $mig.Output; Stop-Fail "Database migrations failed." }
    Write-Ok "database is up to date"
}

Write-Host ""
Write-Host "Setup finished." -ForegroundColor Green
Write-Host "Start Parley with:   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1     (or double-click start.bat)"
Write-Host "Then open:           http://localhost:5643"
