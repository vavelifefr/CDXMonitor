---
name: cdx-stats
description: Show Codex token/context/limit stats from the local CDXMonitor server. Use when the user asks for Codex usage, context fill, or rate limits ($cdx-stats).
---

Show the current CDXMonitor snapshot as a compact text table.

1. Find this skill's directory (the folder containing this SKILL.md file).
2. Run the bundled script (Windows, PowerShell):
   `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\stats.ps1"`
3. Print the script output as is. If the script reports that the server is not
   running, tell the user to start it with the `cdxm` terminal command
   (or `start.cmd` in the CDXMonitor install dir) and retry. Never invent numbers.
