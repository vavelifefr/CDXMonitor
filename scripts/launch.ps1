param(
    [string]$Port = "8765",
    [string]$Bind = "127.0.0.1"
)
# CDXMonitor launcher: starts the local server hidden, logs to %TEMP%.
# Read-only wrt Codex data; writes only its own log.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$main = Join-Path $root "dist\src\main.js"
if (-not (Test-Path -LiteralPath $main)) {
    throw "Server build not found: $main (run 'npm run build' first)"
}
$log = Join-Path $env:TEMP "cdxmonitor-server.log"
$args = "`"$main`" --port $Port --bind $Bind"
Start-Process -FilePath "node" -ArgumentList $args -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError ($log + ".err")
Write-Output "CDXMonitor starting on http://${Bind}:${Port}/ (log: $log)"
