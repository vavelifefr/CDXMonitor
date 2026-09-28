@echo off
rem CDXMonitor portable launcher. Start by double-click.
rem The server runs fully hidden (no console window); diagnostics in data\cdxmonitor.log.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo CDXMonitor: Node.js 24+ not found in PATH.
  echo Install Node.js LTS and retry.
  pause
  exit /b 1
)
if not exist data mkdir data
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'server\main.js --config config\cdxmonitor.json --log-file data\cdxmonitor.log' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=((Get-Content -LiteralPath 'config\cdxmonitor.json' -Encoding UTF8 | ConvertFrom-Json).port); if (-not $port) { $port=8765 }; $ok=$false; for ($i=0; $i -lt 20; $i++) { try { $h=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/api/health') -TimeoutSec 1; if ($h.status -eq 'ok') { $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if ($ok) { Write-Output ('CDXMonitor running: http://127.0.0.1:'+$port+'/') } else { Write-Output 'CDXMonitor did not respond. See data\cdxmonitor.log.'; pause; exit 1 }"
