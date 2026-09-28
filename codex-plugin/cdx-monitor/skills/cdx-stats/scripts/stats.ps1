param()
# cdx-stats helper: prints the CDXMonitor snapshot as compact text.
# Finds the install via %LOCALAPPDATA% candidates (no hardcoded profile).
$ErrorActionPreference = "Stop"

$candidates = @(
    (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\CDXMonitor"),
    (Join-Path $env:LOCALAPPDATA "CDXMonitor")
)
$port = 8765
foreach ($d in $candidates) {
    $cfg = Join-Path $d "config\cdxmonitor.json"
    if (Test-Path -LiteralPath $cfg) {
        try {
            $c = Get-Content -LiteralPath $cfg -Encoding UTF8 | ConvertFrom-Json
            if ($c.port) { $port = [int]$c.port }
            break
        }
        catch {}
    }
}

try {
    $s = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/snapshot" -TimeoutSec 5
}
catch {
    Write-Output "CDXMonitor server is not running. Start it with: cdxm  (or start.cmd in the install dir)"
    exit 1
}

function T([double]$n) {
    $a = [Math]::Abs($n)
    if ($a -ge 1e9) { return ("{0:N2}B" -f ($n / 1e9)) }
    if ($a -ge 1e6) { return ("{0:N2}M" -f ($n / 1e6)) }
    if ($a -ge 1e3) { return ("{0:N1}k" -f ($n / 1e3)) }
    return ([Math]::Truncate($n)).ToString()
}

$lines = @()
$lines += "CDXMonitor  $($s.model)$(if ($s.effort) { " " + $s.effort })"
$lines += ("CTX {0} / {1} ({2:N1}%)  fresh {3}  cache {4:N1}%" -f (T $s.context.used),
    (T $s.context.window), $s.context.fillPct, (T $s.context.fresh), $s.context.cacheRatioPct)
$lines += ("TURN    in {0} / out {1}" -f (T $s.turn.input), (T $s.turn.output))
$lines += ("TASK    in {0} / out {1}" -f (T $s.task.input), (T $s.task.output))
$lines += ("ROLLOUT in {0} / out {1}" -f (T $s.rollout.input), (T $s.rollout.output))
$p5 = $s.limits.primary.usedPercent
$p7 = $s.limits.secondary.usedPercent
$lines += ("LIMITS  5h {0} / weekly {1}" -f (
    $(if ($null -eq $p5) { "n/a" } else { "$p5%" }),
    $(if ($null -eq $p7) { "n/a" } else { "$p7%" })))
$lines += ("TASKS   {0} started / {1} done / {2} running  compaction x{3}" -f $s.tasks.started,
    $s.tasks.completed, $s.tasks.running, $s.compaction.count)
$lines -join "`n"
