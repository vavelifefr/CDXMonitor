"use strict";
// E5 local history (node:sqlite, stdlib). One row per observation tick:
// context fill, TURN/TASK/ROLLOUT, both limits, compaction, tasks.
// Retention 30 days, pruned on every write. DB lives in dataDir (release:
// data/cdxmonitor.sqlite) — updates never touch it.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HISTORY_RETENTION_DAYS = void 0;
exports.openHistory = openHistory;
exports.recordObservation = recordObservation;
exports.queryHistory = queryHistory;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_sqlite_1 = require("node:sqlite");
exports.HISTORY_RETENTION_DAYS = 30;
const SCHEMA = "CREATE TABLE IF NOT EXISTS observations (" +
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
function openHistory(dataDir) {
    if (!dataDir)
        return null;
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        const db = new node_sqlite_1.DatabaseSync(path.join(dataDir, "cdxmonitor.sqlite"));
        db.exec(SCHEMA);
        return db;
    }
    catch {
        return null;
    }
}
function recordObservation(db, state) {
    const pct = state.contextWindow > 0 ? (state.last.input * 100) / state.contextWindow : 0;
    db.prepare("INSERT INTO observations (ts, file, model, ctx_used, ctx_window, fill_pct, " +
        "turn_in, turn_out, task_in, task_out, roll_in, roll_out, lim5h, limweek, " +
        "compaction, tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(Date.now(), state.file ? path.basename(state.file) : "", state.model, state.last.input, state.contextWindow, Math.max(0, Math.min(100, pct)), state.last.input, state.last.output, state.task.input, state.task.output, state.total.input, state.total.output, state.primary.usedPercent, state.secondary.usedPercent, state.compaction.count, state.tasksStarted);
    db.prepare("DELETE FROM observations WHERE ts < ?").run(Date.now() - exports.HISTORY_RETENTION_DAYS * 24 * 3600 * 1000);
}
function queryHistory(db, sinceMs, maxPoints) {
    const rows = db
        .prepare("SELECT ts, fill_pct, turn_in, task_in, roll_in, lim5h, limweek, compaction " +
        "FROM observations WHERE ts >= ? ORDER BY ts")
        .all(sinceMs);
    if (rows.length <= maxPoints) {
        return rows.map(toPoint);
    }
    // Even downsampling: average numeric fields per bucket.
    const out = [];
    const per = rows.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
        const slice = rows.slice(Math.floor(i * per), Math.floor((i + 1) * per));
        if (slice.length === 0)
            continue;
        const avg = (k) => {
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
        const avgNull = (k) => {
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
        const last = slice[slice.length - 1];
        out.push({
            t: typeof last["ts"] === "number" ? last["ts"] : 0,
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
function toPoint(r) {
    const num = (v) => (typeof v === "number" ? v : 0);
    const numNull = (v) => typeof v === "number" ? v : null;
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
