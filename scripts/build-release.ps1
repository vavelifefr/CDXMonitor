# Builds release/CDXMonitor/ from dev outputs + packaging templates.
# Generated dir layout:
#   web/ server/ config/ data/ codex-plugin/ *.cmd *.ps1 README.md setup.exe
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

Write-Output "Building server + UI..."
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tsc build failed" }
npm run build:ui 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

$rel = Join-Path $root "release\CDXMonitor"
# NOTE: never remove $rel itself — external handles (Explorer/AV) can lock an
# empty root persistently while children delete freely. Clean contents only.
if (-not (Test-Path -LiteralPath $rel)) { New-Item -ItemType Directory -Path $rel | Out-Null }
Get-ChildItem -LiteralPath $rel -Force | Remove-Item -Recurse -Force -Confirm:$false
New-Item -ItemType Directory -Path (Join-Path $rel "data") -Force | Out-Null

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
Copy-Item -LiteralPath (Join-Path $root "codex-plugin") -Destination (Join-Path $rel "codex-plugin") -Recurse -Force

# setup.exe / uninstall.exe: tiny launchers, compiled with .NET Framework csc
# (preinstalled on Windows, no SDK/runtime needed on target machines).
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) { throw "csc.exe not found: $csc" }
& $csc /nologo /optimize /target:exe "/out:$(Join-Path $rel 'setup.exe')" "$(Join-Path $pack 'setup.cs')"
if ($LASTEXITCODE -ne 0) { throw "setup.exe compile failed" }
& $csc /nologo /optimize /target:exe "/out:$(Join-Path $rel 'uninstall.exe')" "$(Join-Path $pack 'uninstall.cs')"
if ($LASTEXITCODE -ne 0) { throw "uninstall.exe compile failed" }

$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Encoding UTF8 | ConvertFrom-Json).version
$marker = @{ package = "CDXMonitor"; version = $version } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $rel ".cdxmonitor-release.json"), $marker, (New-Object System.Text.UTF8Encoding -ArgumentList $false))

Write-Output "Release ready: $rel"
Get-ChildItem -LiteralPath $rel | Select-Object Name | Format-Table -HideTableHeaders | Out-String | Write-Output
