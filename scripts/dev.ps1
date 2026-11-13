<#
.SYNOPSIS
  Starts Parley (API + web app) for development and waits until both answer.

.DESCRIPTION
  API:      http://127.0.0.1:<ApiPort>  (this PC only)
  Web app:  http://localhost:<UiPort>   (the browser only ever talks to this port; it proxies /api, including
                                         WebSockets, to the API)
  Ctrl+C stops everything. Use -Detach to leave it running in the background (stop it with stop-dev.ps1).
  Safe next to your other projects: it never touches a process that is not Parley's, and it refuses to start
  on a port that is already taken instead of silently moving to another one.

.PARAMETER Lan
  Opt-in. Make the web app reachable from other PCs on your network (http://<this PC's IP>:<UiPort>).
  Only the web port is opened; the API stays on this PC. Windows Firewall may still need an inbound rule
  for that port; the command is printed, nothing is changed for you.

.EXAMPLE
  .\scripts\dev.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -Lan
.EXAMPLE
  .\scripts\dev.ps1 -Lan -DryRun     # show what would happen without starting anything
#>
[CmdletBinding()]
param(
    [int]$UiPort = 5643,
    [int]$ApiPort = 8643,
    [switch]$Lan,
    [switch]$Detach,
    [switch]$NoBrowser,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root     = $script:RepoRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$logDir   = Join-Path $root '.dev-logs'
$python   = Join-Path $backend '.venv\Scripts\python.exe'

# ---------------------------------------------------------------- pre-flight
if (-not (Test-Path $python))                          { Stop-Fail "The backend is not set up on this PC yet. Run once:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1" }
if (-not (Test-Path (Join-Path $backend '.env')))      { Stop-Fail "backend\.env is missing. Run once:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1" }
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) { Stop-Fail "Frontend packages are missing. Run once:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1" }
if (-not (Test-Path (Join-Path $frontend 'public\widget\parley-widget.js'))) { Write-Note "The chat widget is not built yet (run scripts\setup.ps1); the widget demo page will not work until then." }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npm) { Stop-Fail "Node.js/npm was not found. Install Node.js 20 or newer from https://nodejs.org and open a new terminal." }

# ---------------------------------------------------------------- ports
foreach ($spec in @(@{ Name = 'API'; Port = $ApiPort }, @{ Name = 'Web app'; Port = $UiPort })) {
    foreach ($owner in @(Get-PortOwner $spec.Port)) {
        if (Test-OwnedByRepo $owner) {
            if ($DryRun) {
                Write-Note "Dry run: a previous Parley $($spec.Name) (pid $($owner.Id)) is running; a real start would restart it."
            } else {
                Write-Note "Stopping the previous Parley $($spec.Name) (pid $($owner.Id)) so it can restart."
                Stop-ProcessTree $owner.Id
                Start-Sleep -Milliseconds 800
            }
        } else {
            $short = $owner.Cmd
            if ($short.Length -gt 110) { $short = $short.Substring(0, 110) + '...' }
            $msg = ("Port $($spec.Port) ($($spec.Name)) is already used by another program: $($owner.Name) (pid $($owner.Id))`n       $short`n" +
                    "       That is not Parley, so it is left alone. Pick other ports, for example:`n" +
                    "       .\scripts\dev.ps1 -UiPort 5650 -ApiPort 8650")
            if ($DryRun) { Write-Note "Dry run: a real start would STOP here. $msg" } else { Stop-Fail $msg }
        }
    }
}

# ---------------------------------------------------------------- environment
Clear-ConflictingEnv
$env:UI_PORT = "$UiPort"
$env:API_PORT = "$ApiPort"
Remove-Item Env:UI_HOST -ErrorAction SilentlyContinue
Remove-Item Env:UI_ALLOWED_HOSTS -ErrorAction SilentlyContinue

# Where the web app can be reached from. The API uses this for emailed links and for its (credentialed) CORS list,
# so custom ports and -Lan work without editing backend\.env. (Environment variables take priority over .env.)
$origins = @("http://localhost:$UiPort", "http://parley.localhost:$UiPort", "http://127.0.0.1:$UiPort")
$env:FRONTEND_URL = "http://localhost:$UiPort"

$lanIps = @()
if ($Lan) {
    $lanIps = @(Get-LanAddress)
    if ($lanIps.Count -eq 0) { Stop-Fail "-Lan was requested but no network address was found on this PC." }
    $env:UI_HOST = '0.0.0.0'                       # web app on all interfaces (the API stays on 127.0.0.1)
    $env:UI_ALLOWED_HOSTS = $env:COMPUTERNAME      # so http://<computer-name>:<port> works too
    foreach ($ip in $lanIps) { $origins += "http://${ip}:$UiPort" }
    $origins += "http://$($env:COMPUTERNAME.ToLowerInvariant()):$UiPort"
    $env:FRONTEND_URL = "http://$($lanIps[0]):$UiPort"   # links the API puts in emails
}
$env:CORS_ORIGINS = ConvertTo-Json -InputObject @($origins) -Compress

if ($DryRun) {
    $webHost = '127.0.0.1 (this PC only)'
    if ($Lan) { $webHost = '0.0.0.0 (all network interfaces)' }
    Write-Host ""
    Write-Host "Dry run: nothing was started or changed." -ForegroundColor Yellow
    Write-Host "  API would listen on:      127.0.0.1:$ApiPort (this PC only)"
    Write-Host "  Web app would listen on:  $webHost, port $UiPort"
    Write-Host "  Open on this PC:          http://localhost:$UiPort"
    if ($Lan) {
        foreach ($ip in $lanIps) { Write-Host "  From other PCs:           http://${ip}:$UiPort" }
        Write-Host "  or by computer name:      http://$($env:COMPUTERNAME):$UiPort"
    }
    return
}

# ---------------------------------------------------------------- database migrations
Write-Step "Applying database migrations"
$mig = Invoke-Native $python @('-m', 'alembic', 'upgrade', 'head') $backend
if ($mig.Code -ne 0) {
    Write-Host $mig.Output
    Stop-Fail "Database migrations failed. Check that MySQL is running and backend\.env has the right DATABASE_URL."
}
Write-Ok "database is up to date"

# ---------------------------------------------------------------- start API + web app
New-Item -ItemType Directory -Force $logDir | Out-Null
$apiLog = Join-Path $logDir 'api.log';  $apiErr = Join-Path $logDir 'api.err.log'
$uiLog  = Join-Path $logDir 'ui.log';   $uiErr  = Join-Path $logDir 'ui.err.log'

Write-Step "Starting the API on 127.0.0.1:$ApiPort"
$api = Start-HiddenLogged $python "-m uvicorn app.main:app --host 127.0.0.1 --port $ApiPort --log-level warning" $backend $apiLog $apiErr
if (-not (Wait-Http "http://127.0.0.1:$ApiPort/api/v1/health" 40 $api)) {
    Write-Host (Get-Content $apiErr -Tail 15 -ErrorAction SilentlyContinue | Out-String)
    Stop-ProcessTree $api.Id
    Stop-Fail "The API did not start. Details above and in $apiErr"
}
Write-Ok "API is healthy"

Write-Step "Starting the web app on port $UiPort"
$ui = Start-HiddenLogged $npm.Source "run dev" $frontend $uiLog $uiErr
if (-not (Wait-Http "http://127.0.0.1:$UiPort/" 60 $ui)) {
    Write-Host (Get-Content $uiErr -Tail 15 -ErrorAction SilentlyContinue | Out-String)
    Write-Host (Get-Content $uiLog -Tail 15 -ErrorAction SilentlyContinue | Out-String)
    Stop-ProcessTree $ui.Id
    Stop-ProcessTree $api.Id
    Stop-Fail "The web app did not start. Details above and in $uiLog"
}
Write-Ok "web app is up"

@{ api = $api.Id; ui = $ui.Id; apiPort = $ApiPort; uiPort = $UiPort; started = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content -Encoding ASCII (Join-Path $logDir 'pids.json')

# ---------------------------------------------------------------- tell the user where to go
Write-Host ""
Write-Host "Parley is running" -ForegroundColor Green
Write-Host "  Open this in your browser:   http://localhost:$UiPort" -ForegroundColor White
Write-Host "  Same app, own cookie jar:    http://parley.localhost:$UiPort"
Write-Host "  Chat widget demo page:       http://localhost:$UiPort/widget/demo.html?ws=<your workspace address>"
Write-Host "  API documentation:           http://localhost:$UiPort/api/docs"
Write-Host "  Logs:                        $logDir"
if ($Lan) {
    Write-Host ""
    Write-Host "  From other PCs on your network:" -ForegroundColor Yellow
    foreach ($ip in $lanIps) { Write-Host "    http://${ip}:$UiPort" }
    Write-Host "    http://$($env:COMPUTERNAME):$UiPort"
    Write-Host "  Windows Firewall usually blocks inbound connections. If another PC cannot connect, run this ONCE"
    Write-Host "  in an Administrator PowerShell (only the web port is opened, private networks only):" -ForegroundColor Yellow
    Write-Host "    New-NetFirewallRule -DisplayName 'Parley dev web ($UiPort)' -Direction Inbound -Protocol TCP -LocalPort $UiPort -Action Allow -Profile Private"
    Write-Host "  Anyone on that network can then open the app and register a workspace. Use it on trusted networks only." -ForegroundColor Yellow
}
Write-Host ""

if (-not $NoBrowser) { Start-Process "http://localhost:$UiPort" }

if ($Detach) {
    Write-Host "Running in the background. Stop it with:  .\scripts\stop-dev.ps1"
    return
}

Write-Host "Press Ctrl+C to stop Parley."
try {
    while ($true) {
        if ($api.HasExited) { Write-Host "The API stopped unexpectedly. See $apiErr" -ForegroundColor Red; break }
        if ($ui.HasExited)  { Write-Host "The web app stopped unexpectedly. See $uiErr" -ForegroundColor Red; break }
        Start-Sleep -Seconds 1
    }
} finally {
    Stop-ProcessTree $ui.Id
    Stop-ProcessTree $api.Id
    Write-Host "Parley stopped."
}
