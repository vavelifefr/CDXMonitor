param(
    [string]$Target = "",
    [switch]$RemoveData,
    [string]$HomeRoot = ""
)
# CDXMonitor portable uninstall. Removes only CDXMonitor files.
# Refuses to run outside a marked install directory. Keeps data\ unless -RemoveData.
$ErrorActionPreference = "Stop"

if (-not $Target) { $Target = $PSScriptRoot }
$Target = [IO.Path]::GetFullPath($Target)
$marker = Join-Path $Target ".cdxmonitor-release.json"
if (-not (Test-Path -LiteralPath $marker)) {
    throw "Refusing: no CDXMonitor install marker in: $Target"
}

Get-ChildItem -LiteralPath $Target -Force | ForEach-Object {
    if (($_.Name -eq "data" -or $_.Name -eq ".cdxmonitor-release.json") -and -not $RemoveData) { return }
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
}
if ($RemoveData) {
    Remove-Item -LiteralPath $Target -Force
    Write-Output "Removed (including data): $Target"
}
else {
    Write-Output "Removed app files. Kept user data: $(Join-Path $Target 'data')"
}

# Remove the cdxmonitor:// protocol registration (best effort, HKCU only).
try {
    $protoBase = "HKCU:\Software\Classes\cdxmonitor"
    if (Test-Path -LiteralPath $protoBase) {
        Remove-Item -LiteralPath $protoBase -Recurse -Force
        Write-Output "Protocol cdxmonitor:// unregistered."
    }
}
catch {
    Write-Output ("WARNING: protocol removal failed: " + $_.Exception.Message)
}

# Remove install dir from user PATH (best effort).
try {
    $cur = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($cur) {
        $parts = @($cur -split ";" | Where-Object {
            $_ -and ($_.TrimEnd("\") -ine $Target.TrimEnd("\"))
        })
        [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
        Write-Output "Removed from PATH."
    }
}
catch {
    Write-Output ("WARNING: PATH cleanup failed: " + $_.Exception.Message)
}

# Remove the Codex plugin (best effort): dir + marketplace entry.
try {
    $homeRoot = if ($HomeRoot) { $HomeRoot } else { $env:USERPROFILE }
    $plugDir = Join-Path $homeRoot ".codex\plugins\cdx-monitor"
    if (Test-Path -LiteralPath $plugDir) {
        Remove-Item -LiteralPath $plugDir -Recurse -Force
        Write-Output "Codex plugin removed."
    }
    $marketFile = Join-Path $homeRoot ".agents\plugins\marketplace.json"
    if (Test-Path -LiteralPath $marketFile) {
        Copy-Item -LiteralPath $marketFile -Destination ($marketFile + ".bak") -Force
        $market = Get-Content -LiteralPath $marketFile -Encoding UTF8 | ConvertFrom-Json
        if ($market.plugins) {
            $market.plugins = @($market.plugins | Where-Object { $_.name -ne "cdx-monitor" })
            [IO.File]::WriteAllText($marketFile,
                ($market | ConvertTo-Json -Depth 6),
                (New-Object System.Text.UTF8Encoding -ArgumentList $false))
            Write-Output "Codex plugin entry removed from marketplace."
        }
    }
}
catch {
    Write-Output ("WARNING: plugin cleanup failed: " + $_.Exception.Message)
}
