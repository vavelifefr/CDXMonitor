param(
    [string]$Page = "",
    [switch]$DryRun
)
# cdx-open helper: opens the CDXMonitor web UI in Chrome (fallback: default browser).
# -DryRun prints URL and Chrome path instead of launching.
$ErrorActionPreference = "Stop"

$candidates = @(
    (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\CDXMonitor"),
    (Join-Path $env:LOCALAPPDATA "CDXMonitor")
)
$port = 8765
$webDir = ""
foreach ($d in $candidates) {
    $cfg = Join-Path $d "config\cdxmonitor.json"
    if (Test-Path -LiteralPath $cfg) {
        try {
            $c = Get-Content -LiteralPath $cfg -Encoding UTF8 | ConvertFrom-Json
            if ($c.port) { $port = [int]$c.port }
        }
        catch {}
        $webDir = Join-Path $d "web"
        break
    }
}

function Test-Server {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        return ($h.status -eq "ok")
    }
    catch { return $false }
}

$up = Test-Server
if ($Page -ieq "help") {
    $url = if ($up) { "http://127.0.0.1:$port/help.html" } else { Join-Path $webDir "help.html" }
}
else {
    $url = if ($up) { "http://127.0.0.1:$port/" } else { Join-Path $webDir "boot.html" }
}
if ($url -like "*.html" -and $url -notlike "http*") { $url = "file:///" + ($url -replace "\\", "/") }

$chrome = ""
try {
    $cmd = Get-Command chrome -ErrorAction Stop
    $chrome = $cmd.Source
}
catch {
    foreach ($p in @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"))) {
        if (Test-Path -LiteralPath $p) { $chrome = $p; break }
    }
}

if ($DryRun) {
    Write-Output ("URL=" + $url)
    Write-Output ("CHROME=" + $(if ($chrome) { $chrome } else { "(default browser)" }))
    exit 0
}
if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url }
else { Start-Process $url }
Write-Output ("Opened: " + $url)
