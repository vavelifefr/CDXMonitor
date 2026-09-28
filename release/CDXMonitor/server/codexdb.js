"use strict";
// Read-only Codex SQLite/JSON adapter (E4). Sources:
//   state_5.sqlite: threads, projects
//   thread_history_1.sqlite: thread_turns
//   models_cache.json: model catalog windows
// Databases are opened read-only per request and closed immediately.
// Any failure yields {available:false} — never throws to callers.
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
exports.codexBaseFromSessions = codexBaseFromSessions;
exports.listProjects = listProjects;
exports.listThreads = listThreads;
exports.threadTurns = threadTurns;
exports.readCatalog = readCatalog;
exports.filesPresent = filesPresent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_sqlite_1 = require("node:sqlite");
function codexBaseFromSessions(sessionsRoot) {
    const baseDir = path.basename(sessionsRoot) === "sessions"
        ? path.dirname(sessionsRoot)
        : sessionsRoot;
    return {
        baseDir,
        stateDb: path.join(baseDir, "state_5.sqlite"),
        historyDb: path.join(baseDir, "thread_history_1.sqlite"),
        modelsCache: path.join(baseDir, "models_cache.json"),
    };
}
function openReadOnly(dbPath) {
    try {
        if (!fs.existsSync(dbPath))
            return null;
        return new node_sqlite_1.DatabaseSync(dbPath, { readOnly: true });
    }
    catch {
        return null;
    }
}
function str(value) {
    return typeof value === "string" ? value : "";
}
function numOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function listProjects(base) {
    const db = openReadOnly(base.stateDb);
    if (!db)
        return [];
    try {
        const rows = db
            .prepare("SELECT id, name FROM projects ORDER BY position, name")
            .all();
        return rows.map((r) => ({ id: str(r["id"]), name: str(r["name"]) }));
    }
    catch {
        return [];
    }
    finally {
        try {
            db.close();
        }
        catch {
            // ignore
        }
    }
}
function listThreads(base, limit) {
    const db = openReadOnly(base.stateDb);
    if (!db)
        return [];
    try {
        const rows = db
            .prepare("SELECT id, title, model, reasoning_effort, cwd, tokens_used, " +
            "thread_source, archived, project_id, created_at, updated_at " +
            "FROM threads ORDER BY updated_at_ms DESC LIMIT ?")
            .all(Math.max(1, Math.min(500, limit)));
        return rows.map((r) => ({
            id: str(r["id"]),
            title: str(r["title"]),
            model: str(r["model"]),
            reasoningEffort: str(r["reasoning_effort"]),
            cwd: str(r["cwd"]),
            tokensUsed: numOrNull(r["tokens_used"]),
            threadSource: str(r["thread_source"]),
            archived: r["archived"] === 1,
            projectId: str(r["project_id"]),
            createdAt: str(r["created_at"]),
            updatedAt: str(r["updated_at"]),
        }));
    }
    catch {
        return [];
    }
    finally {
        try {
            db.close();
        }
        catch {
            // ignore
        }
    }
}
function threadTurns(base, threadId) {
    const db = openReadOnly(base.historyDb);
    if (!db || !threadId)
        return [];
    try {
        const rows = db
            .prepare("SELECT turn_id, status, duration_ms, started_at, completed_at " +
            "FROM thread_turns WHERE thread_id = ? ORDER BY started_at")
            .all(threadId);
        return rows.map((r) => ({
            turnId: str(r["turn_id"]),
            status: str(r["status"]),
            durationMs: numOrNull(r["duration_ms"]),
            startedAt: str(r["started_at"]),
            completedAt: str(r["completed_at"]),
        }));
    }
    catch {
        return [];
    }
    finally {
        try {
            db.close();
        }
        catch {
            // ignore
        }
    }
}
function readCatalog(base) {
    try {
        const raw = fs.readFileSync(base.modelsCache, "utf8");
        const parsed = JSON.parse(raw);
        const dict = (parsed !== null && typeof parsed === "object" ? parsed : {});
        const models = Array.isArray(dict["models"]) ? dict["models"] : [];
        const out = [];
        for (const m of models) {
            if (typeof m !== "object" || m === null)
                continue;
            const spec = m;
            out.push({
                slug: str(spec["slug"]),
                displayName: str(spec["display_name"]),
                contextWindow: numOrNull(spec["context_window"]),
                maxContextWindow: numOrNull(spec["max_context_window"]),
                effectivePercent: numOrNull(spec["effective_context_window_percent"]),
            });
        }
        return out;
    }
    catch {
        return [];
    }
}
function filesPresent(base) {
    return {
        stateDb: fs.existsSync(base.stateDb),
        historyDb: fs.existsSync(base.historyDb),
        modelsCache: fs.existsSync(base.modelsCache),
    };
}
