# Builds release/CDXMonitor/ from dev outputs + packaging templates.
# Generated dir layout:
#   web/ server/ config/ data/ start.cmd stop.cmd install.ps1 uninstall.ps1 README.md
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

Write-Output "Building server + UI..."
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tsc build failed" }
npm run build:ui 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

$rel = Join-Path $root "release\CDXMonitor"
if (Test-Path -LiteralPath $rel) { Remove-Item -LiteralPath $rel -Recurse -Force }
New-Item -ItemType Directory -Path $rel | Out-Null
New-Item -ItemType Directory -Path (Join-Path $rel "data") | Out-Null

New-Item -ItemType Directory -Path (Join-Path $rel "web") -Force | Out-Null
foreach ($f in @("boot.html", "help.html", "stub.html", "Statistic.html")) {
    Copy-Item -LiteralPath (Join-Path $root "web\$f") -Destination (Join-Path $rel "web\$f") -Force
}
Copy-Item -LiteralPath (Join-Path $root "web\app") -Destination (Join-Path $rel "web\app") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "dist\src") -Destination (Join-Path $rel "server") -Recurse -Force

$pack = Join-Path $root "packaging"
foreach ($f in @("start.cmd", "stop.cmd", "cdxm.cmd", "cdxm.ps1", "install.ps1", "uninstall.ps1", "README.md")) {
    Copy-Item -LiteralPath (Join-Path $pack $f) -Destination (Join-Path $rel $f) -Force
}
New-Item -ItemType Directory -Path (Join-Path $rel "config") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $pack "config\cdxmonitor.json") -Destination (Join-Path $rel "config\cdxmonitor.json") -Force

$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Encoding UTF8 | ConvertFrom-Json).version
$marker = @{ package = "CDXMonitor"; version = $version } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $rel ".cdxmonitor-release.json"), $marker, (New-Object System.Text.UTF8Encoding -ArgumentList $false))

Write-Output "Release ready: $rel"
Get-ChildItem -LiteralPath $rel | Select-Object Name | Format-Table -HideTableHeaders | Out-String | Write-Output
