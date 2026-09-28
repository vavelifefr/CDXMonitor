@echo off
rem cdxm - CDXMonitor terminal command (thin wrapper, works from cmd and PowerShell).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cdxm.ps1" %*
