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
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -Confirm:$false
}
if ($RemoveData) {
    # Fresh binaries are often briefly locked by AV/indexer: retry, then fall
    # back to a deferred removal instead of failing.
    $removed = $false
    for ($i = 0; $i -lt 10 -and -not $removed; $i++) {
        try {
            Remove-Item -LiteralPath $Target -Recurse -Force -Confirm:$false -ErrorAction Stop
            $removed = $true
        }
        catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $removed) {
        try {
            # Fresh binaries stay locked for minutes: retry in background (~10 min).
            # NOTE: the whole body must stay inside (...) — a bare & would end
            # the FOR body and run rd only once after all pings.
            # NOTE 2: cd away first — a cleaner running with CWD inside $Target
            # locks the root itself (observed with our own loop).
            $cmd = "/c cd /d `"%TEMP%`" & for /L %i in (1,1,120) do (@ping -n 6 127.0.0.1 >nul & " +
                "@rd /s /q `"$Target`" 2>nul & @if not exist `"$Target`" exit)"
            Start-Process -FilePath "cmd.exe" -ArgumentList $cmd -WindowStyle Hidden `
                -WorkingDirectory $env:TEMP
            Write-Output "Install dir busy (antivirus/indexer). Removal scheduled (~10 min): $Target"
            $removed = $true
        }
        catch {
            throw "Could not remove install dir (locked): $Target. Delete it manually."
        }
    }
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Output "Removed (including data): $Target"
    }
    else {
        Write-Output "Pending deferred removal, verify in ~10 min: $Target"
    }
}
else {
    Write-Output "Removed app files. Kept user data: $(Join-Path $Target 'data')"
}

# Remove the cdxmonitor:// protocol registration (best effort, HKCU only).
try {
    $protoBase = "HKCU:\Software\Classes\cdxmonitor"
    if (Test-Path -LiteralPath $protoBase) {
        Remove-Item -LiteralPath $protoBase -Recurse -Force -Confirm:$false
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
        Remove-Item -LiteralPath $plugDir -Recurse -Force -Confirm:$false
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
