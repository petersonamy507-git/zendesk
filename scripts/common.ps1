# Shared helpers for the Parley scripts (dot-sourced by dev.ps1, stop-dev.ps1 and setup.ps1).

$script:RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "    !!  $Message" -ForegroundColor Yellow }

function Stop-Fail([string]$Message) {
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# Who is listening on a TCP port? Returns objects with Id, Name and Cmd (full command line).
function Get-PortOwner([int]$Port) {
    $ids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($id in $ids) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
        $cmd = ''
        if ($null -ne $p -and $null -ne $p.CommandLine) { $cmd = [string]$p.CommandLine }
        $name = ''
        if ($null -ne $p) { $name = [string]$p.Name }
        [pscustomobject]@{ Id = [int]$id; Name = $name; Cmd = $cmd }
    }
}

# True when a process was started from this repository (so it is safe for these scripts to stop it).
function Test-OwnedByRepo($Owner) {
    return ($Owner.Cmd.Length -gt 0) -and $Owner.Cmd.ToLowerInvariant().Contains($script:RepoRoot.ToLowerInvariant())
}

# Kill a process and everything it started (npm -> node -> vite, uvicorn workers...).
function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
    $ErrorActionPreference = $old
}

# Start a program hidden with stdout/stderr written to log files, WITHOUT inheriting this process's handles.
# Start-Process -RedirectStandardOutput makes the child inherit every inheritable handle of the caller; that keeps
# the caller's pipes open, so anything waiting for this script to finish (editors, CI, other scripts) hangs even
# after -Detach returns. Going through cmd.exe /c with the redirection inside the command line avoids that.
function Start-HiddenLogged([string]$File, [string]$ArgumentLine, [string]$WorkingDirectory, [string]$OutLog, [string]$ErrLog) {
    $inner = '"' + $File + '" ' + $ArgumentLine + ' 1>"' + $OutLog + '" 2>"' + $ErrLog + '"'
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList ('/d /s /c "' + $inner + '"') `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
}

# Run a native command without PowerShell 5.1 turning its stderr output into terminating errors.
function Invoke-Native([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location $WorkingDirectory
    try {
        $lines = & $File @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $ErrorActionPreference = $old
    }
    [pscustomobject]@{ Code = $code; Output = (($lines | Out-String).TrimEnd()) }
}

# Poll a URL until it answers (any status below 500) or the optional process dies / time runs out.
function Wait-Http([string]$Url, [int]$Seconds, $Process) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -ne $Process -and $Process.HasExited) { return $false }
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { return $true }
        } catch {
            # not up yet (or a 4xx/5xx response, which PowerShell 5.1 raises as an exception)
            if ($_.Exception.Response -ne $null) {
                try { if ([int]$_.Exception.Response.StatusCode -lt 500) { return $true } } catch { }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# IPv4 addresses other PCs on the network could use to reach this one (physical adapters first).
function Get-LanAddress {
    $skip = 'vEthernet|VMware|VirtualBox|Loopback|Bluetooth|WSL|Hyper-V|Docker|Tailscale|ZeroTier'
    @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch $skip } |
        Sort-Object InterfaceMetric |
        Select-Object -ExpandProperty IPAddress)
}

# Settings that another project on this PC may have exported globally; they would silently override backend\.env.
$script:ConflictingEnv = 'DATABASE_URL', 'TEST_DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'CORS_ORIGINS', 'FRONTEND_URL', 'TRUSTED_PROXIES', 'ENVIRONMENT', 'SMTP_HOST', 'UPLOAD_DIR', 'S3_ENDPOINT', 'S3_BUCKET'
function Clear-ConflictingEnv {
    foreach ($n in $script:ConflictingEnv) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
