param(
    [string]$Action = ""
)
# cdxm - CDXMonitor terminal command. Runs from the install root.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$cfgPath = Join-Path $root "config\cdxmonitor.json"
$port = 8765
try {
    $c = Get-Content -LiteralPath $cfgPath -Encoding UTF8 | ConvertFrom-Json
    if ($c.port) { $port = [int]$c.port }
}
catch {}
$url = "http://127.0.0.1:$port/"

function Test-Server {
    try {
        $h = Invoke-RestMethod -Uri ($url + "api/health") -TimeoutSec 2
        return ($h.status -eq "ok")
    }
    catch { return $false }
}

function Start-Server {
    Start-Process -FilePath "node" `
        -ArgumentList "server\main.js --config config\cdxmonitor.json --log-file data\cdxmonitor.log" `
        -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Server) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Ensure-Running {
    if (Test-Server) { return $true }
    if (Start-Server) { return $true }
    Write-Output "CDXMonitor did not start. See data\cdxmonitor.log."
    exit 1
}

function Show-Help {
    Write-Output "cdxm - CDXMonitor: локальный монитор Codex Desktop"
    Write-Output ("  cdxm         поднять сервер и показать URL (клик по URL во встроенном " +
        "терминале Codex открывает его во встроенном браузере)")
    Write-Output "  cdxm --open  поднять сервер и открыть в браузере по умолчанию"
    Write-Output "  cdxm stop    остановить сервер"
    Write-Output "  cdxm status  статус сервера"
    Write-Output "  cdxm help    эта справка"
}

switch ($Action) {
    "" {
        Ensure-Running | Out-Null
        Write-Output $url
        Write-Output "Кликните URL во встроенном терминале Codex — откроется во встроенном браузере."
    }
    "--open" {
        Ensure-Running | Out-Null
        Start-Process $url
    }
    "stop" { & (Join-Path $root "stop.cmd") }
    "status" {
        if (Test-Server) { Write-Output "CDXMonitor running: $url" }
        else { Write-Output "CDXMonitor stopped."; exit 1 }
    }
    { @("help", "--help", "-h") -contains $_ } { Show-Help }
    default { Show-Help; exit 1 }
}
