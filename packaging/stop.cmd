@echo off
rem CDXMonitor portable stop. Reads the PID file written at startup.
cd /d "%~dp0"
if not exist data\cdxmonitor.pid (
  echo CDXMonitor: PID file not found, server may not be running.
  exit /b 1
)
set /p CDXPID=<data\cdxmonitor.pid
taskkill /PID %CDXPID% /F
del data\cdxmonitor.pid
if exist data\server.lock del data\server.lock
powershell -NoProfile -Command "$port=((Get-Content -LiteralPath 'config\cdxmonitor.json' -Encoding UTF8 | ConvertFrom-Json).port); if (-not $port) { $port=8765 }; $lock=Join-Path $env:TEMP ('cdxmonitor-port-'+$port+'.lock'); if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force }; Add-Content -LiteralPath 'data\cdxmonitor.log' -Value ((Get-Date -Format o)+' stopped via stop.cmd') -Encoding UTF8"
echo CDXMonitor stopped.
