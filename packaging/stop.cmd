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
echo CDXMonitor stopped.
