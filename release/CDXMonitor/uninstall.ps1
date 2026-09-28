param(
    [string]$Target = "",
    [switch]$RemoveData
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
