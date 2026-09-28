param(
    [string]$Target = "",
    [switch]$Force
)
# CDXMonitor portable installer. Copies this package to the target directory.
# - Never touches Codex files: target must be a "...\CDXMonitor" directory.
# - Existing data\ (history, settings) is preserved on update.
# - Without -Target, asks where to install (Codex dir or fallback).
$ErrorActionPreference = "Stop"

function Resolve-Target([string]$t) {
    $full = [IO.Path]::GetFullPath($t)
    if ([IO.Path]::GetFileName($full) -ne "CDXMonitor") {
        throw "Refusing: target must be a directory named 'CDXMonitor', got: $full"
    }
    return $full
}

$src = $PSScriptRoot
$marker = Join-Path $src ".cdxmonitor-release.json"
if (-not (Test-Path -LiteralPath $marker)) {
    throw "Not a CDXMonitor package (marker missing): $src"
}

$codexTarget = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\CDXMonitor"
$fallbackTarget = Join-Path $env:LOCALAPPDATA "CDXMonitor"

if (-not $Target) {
    Write-Output "Install CDXMonitor to:"
    Write-Output ("  [1] " + $codexTarget + "  (next to Codex)")
    Write-Output ("  [2] " + $fallbackTarget + "  (fallback)")
    $choice = Read-Host "Choice [1/2] (default 1)"
    if ($choice -eq "2") { $Target = $fallbackTarget } else { $Target = $codexTarget }
}
$Target = Resolve-Target $Target

$codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
if ((Test-Path -LiteralPath $codexBin) -and $Target.StartsWith($codexBin, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing: target is inside Codex bin directory: $Target"
}

if (-not (Test-Path -LiteralPath $Target)) {
    New-Item -ItemType Directory -Path $Target | Out-Null
}
else {
    $existing = Get-ChildItem -LiteralPath $Target -Force | Where-Object { $_.Name -ne "data" }
    if ($existing -and -not $Force) {
        Write-Output "Target already contains files:"
        $existing | ForEach-Object { Write-Output ("  " + $_.Name) }
        $answer = Read-Host "Overwrite (data\ is always preserved)? [y/N]"
        if ($answer -ne "y" -and $answer -ne "Y") { Write-Output "Aborted."; exit 1 }
    }
}

Get-ChildItem -LiteralPath $src -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object {
    $dest = Join-Path $Target $_.Name
    if ($_.PSIsContainer) {
        if (-not (Test-Path -LiteralPath $dest)) {
            New-Item -ItemType Directory -Path $dest | Out-Null
        }
        # Copy CONTENTS (-Path expands the wildcard; -LiteralPath would not).
        Copy-Item -Path (Join-Path $_.FullName "*") -Destination $dest -Recurse -Force
    }
    else {
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
}
# Migration: pre-fix installer nested dirs instead of updating them.
foreach ($nested in @("web\web", "server\server", "config\config")) {
    $p = Join-Path $Target $nested
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}

# Absolutize inter-page links in the INSTALLED copy to full machine-specific
# file:/// URLs (idempotent: already-absolute links are rewritten, not doubled).
# Server URLs (http...), mailto: and cdxmonitor: links are never touched.
$webTarget = Join-Path $Target "web"
$fileUrlBase = "file:///" + ($webTarget -replace "\\", "/")
foreach ($page in @("boot.html", "help.html", "stub.html", "Statistic.html")) {
    $p = Join-Path $webTarget $page
    if (-not (Test-Path -LiteralPath $p)) { continue }
    Copy-Item -LiteralPath $p -Destination ($p + ".bak") -Force
    $text = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
    $text = [regex]::Replace($text,
        'href="(?:file:///[^"]*/web/)?(boot\.html|help\.html|stub\.html|Statistic\.html)"',
        { param($m) 'href="' + $fileUrlBase + '/' + $m.Groups[1].Value + '"' })
    $utf8bom = New-Object System.Text.UTF8Encoding -ArgumentList $true
    [IO.File]::WriteAllText($p, $text, $utf8bom)
}
$dataTarget = Join-Path $Target "data"
if (-not (Test-Path -LiteralPath $dataTarget)) {
    New-Item -ItemType Directory -Path $dataTarget | Out-Null
}

# Register cdxmonitor:// protocol (HKCU, no admin) so the boot page button
# can start the server. Hidden launch, no console window.
try {
    $protoBase = "HKCU:\Software\Classes\cdxmonitor"
    New-Item -Path $protoBase -Force | Out-Null
    Set-ItemProperty -Path $protoBase -Name "(default)" -Value "URL:CDXMonitor"
    Set-ItemProperty -Path $protoBase -Name "URL Protocol" -Value ""
    New-Item -Path "$protoBase\shell\open\command" -Force | Out-Null
    $launchCmd = "powershell.exe -NoProfile -WindowStyle Hidden -Command `"Start-Process -FilePath 'node' -ArgumentList 'server\main.js --config config\cdxmonitor.json --log-file data\cdxmonitor.log' -WorkingDirectory '$Target' -WindowStyle Hidden`""
    Set-ItemProperty -Path "$protoBase\shell\open\command" -Name "(default)" -Value $launchCmd
    Write-Output "Protocol cdxmonitor:// registered."
}
catch {
    Write-Output ("WARNING: protocol registration failed: " + $_.Exception.Message)
    Write-Output "The boot button will not work; use start.cmd directly."
}

Write-Output "Installed to: $Target"
Write-Output "Start: double-click start.cmd, then open http://127.0.0.1:8765/ in the Codex side-panel browser."
