// E5 local history (node:sqlite, stdlib). One row per observation tick:
// context fill, TURN/TASK/ROLLOUT, both limits, compaction, tasks.
// Retention 30 days, pruned on every write. DB lives in dataDir (release:
// data/cdxmonitor.sqlite) — updates never touch it.

import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import { CollectorState } from "./collector/types";

export const HISTORY_RETENTION_DAYS = 30;

const SCHEMA =
  "CREATE TABLE IF NOT EXISTS observations (" +
  "ts INTEGER NOT NULL, " +
  "file TEXT NOT NULL DEFAULT '', " +
  "model TEXT NOT NULL DEFAULT '', " +
  "ctx_used INTEGER NOT NULL DEFAULT 0, " +
  "ctx_window INTEGER NOT NULL DEFAULT 0, " +
  "fill_pct REAL NOT NULL DEFAULT 0, " +
  "turn_in INTEGER NOT NULL DEFAULT 0, " +
  "turn_out INTEGER NOT NULL DEFAULT 0, " +
  "task_in INTEGER NOT NULL DEFAULT 0, " +
  "task_out INTEGER NOT NULL DEFAULT 0, " +
  "roll_in INTEGER NOT NULL DEFAULT 0, " +
  "roll_out INTEGER NOT NULL DEFAULT 0, " +
  "lim5h REAL, " +
  "limweek REAL, " +
  "compaction INTEGER NOT NULL DEFAULT 0, " +
  "tasks INTEGER NOT NULL DEFAULT 0" +
  "); " +
  "CREATE INDEX IF NOT EXISTS idx_obs_ts ON observations (ts);";

export function openHistory(dataDir: string | null): DatabaseSync | null {
  if (!dataDir) return null;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "cdxmonitor.sqlite"));
    db.exec(SCHEMA);
    return db;
  } catch {
    return null;
  }
}

export function recordObservation(db: DatabaseSync, state: CollectorState): void {
  const pct =
    state.contextWindow > 0 ? (state.last.input * 100) / state.contextWindow : 0;
  db.prepare(
    "INSERT INTO observations (ts, file, model, ctx_used, ctx_window, fill_pct, " +
      "turn_in, turn_out, task_in, task_out, roll_in, roll_out, lim5h, limweek, " +
      "compaction, tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    Date.now(),
    state.file ? path.basename(state.file) : "",
    state.model,
    state.last.input,
    state.contextWindow,
    Math.max(0, Math.min(100, pct)),
    state.last.input,
    state.last.output,
    state.task.input,
    state.task.output,
    state.total.input,
    state.total.output,
    state.primary.usedPercent,
    state.secondary.usedPercent,
    state.compaction.count,
    state.tasksStarted,
  );
  db.prepare("DELETE FROM observations WHERE ts < ?").run(
    Date.now() - HISTORY_RETENTION_DAYS * 24 * 3600 * 1000,
  );
}

export interface HistoryPoint {
  t: number;
  fillPct: number;
  turnIn: number;
  taskIn: number;
  rollIn: number;
  lim5h: number | null;
  limWeek: number | null;
  compaction: number;
}

export function queryHistory(
  db: DatabaseSync,
  sinceMs: number,
  maxPoints: number,
): HistoryPoint[] {
  const rows = db
    .prepare(
      "SELECT ts, fill_pct, turn_in, task_in, roll_in, lim5h, limweek, compaction " +
        "FROM observations WHERE ts >= ? ORDER BY ts",
    )
    .all(sinceMs) as Array<Record<string, unknown>>;
  if (rows.length <= maxPoints) {
    return rows.map(toPoint);
  }
  // Even downsampling: average numeric fields per bucket.
  const out: HistoryPoint[] = [];
  const per = rows.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const slice = rows.slice(Math.floor(i * per), Math.floor((i + 1) * per));
    if (slice.length === 0) continue;
    const avg = (k: string): number => {
      let sum = 0;
      let n = 0;
      for (const r of slice) {
        const v = r[k];
        if (typeof v === "number") {
          sum += v;
          n++;
        }
      }
      return n > 0 ? sum / n : 0;
    };
    const avgNull = (k: string): number | null => {
      let sum = 0;
      let n = 0;
      for (const r of slice) {
        const v = r[k];
        if (typeof v === "number") {
          sum += v;
          n++;
        }
      }
      return n > 0 ? sum / n : null;
    };
    const last = slice[slice.length - 1] as Record<string, unknown>;
    out.push({
      t: typeof last["ts"] === "number" ? (last["ts"] as number) : 0,
      fillPct: avg("fill_pct"),
      turnIn: avg("turn_in"),
      taskIn: avg("task_in"),
      rollIn: avg("roll_in"),
      lim5h: avgNull("lim5h"),
      limWeek: avgNull("limweek"),
      compaction: avg("compaction"),
    });
  }
  return out;
}

function toPoint(r: Record<string, unknown>): HistoryPoint {
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const numNull = (v: unknown): number | null =>
    typeof v === "number" ? v : null;
  return {
    t: num(r["ts"]),
    fillPct: num(r["fill_pct"]),
    turnIn: num(r["turn_in"]),
    taskIn: num(r["task_in"]),
    rollIn: num(r["roll_in"]),
    lim5h: numNull(r["lim5h"]),
    limWeek: numNull(r["limweek"]),
    compaction: num(r["compaction"]),
  };
}
