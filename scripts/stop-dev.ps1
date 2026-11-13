<#
.SYNOPSIS
  Stops the Parley API and web app started by dev.ps1 (including -Detach). Never touches other programs.
#>
[CmdletBinding()]
param(
    [int]$UiPort = 5643,
    [int]$ApiPort = 8643
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root    = $script:RepoRoot
$pidFile = Join-Path $root '.dev-logs\pids.json'
$stopped = 0

if (Test-Path $pidFile) {
    try {
        $info = Get-Content $pidFile -Raw | ConvertFrom-Json
        if ($info.uiPort)  { $UiPort = [int]$info.uiPort }
        if ($info.apiPort) { $ApiPort = [int]$info.apiPort }
        foreach ($id in @($info.ui, $info.api)) {
            if ($id) { Stop-ProcessTree ([int]$id); $stopped++ }
        }
    } catch { Write-Note "Could not read $pidFile; falling back to the ports." }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# Anything of ours still holding the ports (for example after a crash). Other programs are left alone.
foreach ($spec in @(@{ Name = 'API'; Port = $ApiPort }, @{ Name = 'Web app'; Port = $UiPort })) {
    foreach ($owner in @(Get-PortOwner $spec.Port)) {
        if (Test-OwnedByRepo $owner) {
            Stop-ProcessTree $owner.Id
            $stopped++
        } else {
            Write-Note "Port $($spec.Port) is used by $($owner.Name) (pid $($owner.Id)). That is not Parley; left running."
        }
    }
}

if ($stopped -gt 0) { Write-Host "Parley stopped." -ForegroundColor Green } else { Write-Host "Parley was not running." }
