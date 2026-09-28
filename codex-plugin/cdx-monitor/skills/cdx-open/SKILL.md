---
name: cdx-open
description: Open the CDXMonitor web UI in Chrome (or the default browser). Use when the user asks to open/show the monitor ($cdx-open).
---

Open the CDXMonitor web interface in a browser.

1. Find this skill's directory (the folder containing this SKILL.md file).
2. Run the bundled script (Windows, PowerShell):
   `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\open.ps1"`
   Append `-Page help` to open the help page instead of the monitor.
3. Report which URL was opened and in which browser. If Chrome is missing, the
   script falls back to the default browser — mention that.
