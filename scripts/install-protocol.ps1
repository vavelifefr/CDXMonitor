# CDXMonitor one-time setup: registers the cdxmonitor:// protocol in HKCU
# (no admin rights needed) so the boot page button can start the server.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$launch = Join-Path $root "scripts\launch.ps1"
$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launch`""
$base = "HKCU:\Software\Classes\cdxmonitor"
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(default)" -Value "URL:CDXMonitor"
Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""
New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name "(default)" -Value $cmd
Write-Output "Protocol cdxmonitor:// registered -> $launch"
