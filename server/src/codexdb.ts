// Read-only Codex SQLite/JSON adapter (E4). Sources:
//   state_5.sqlite: threads, projects
//   thread_history_1.sqlite: thread_turns
//   models_cache.json: model catalog windows
// Databases are opened read-only per request and closed immediately.
// Any failure yields {available:false} — never throws to callers.

import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";

export interface CodexBase {
  baseDir: string;
  stateDb: string;
  historyDb: string;
  modelsCache: string;
}

export function codexBaseFromSessions(sessionsRoot: string): CodexBase {
  const baseDir =
    path.basename(sessionsRoot) === "sessions"
      ? path.dirname(sessionsRoot)
      : sessionsRoot;
  return {
    baseDir,
    stateDb: path.join(baseDir, "state_5.sqlite"),
    historyDb: path.join(baseDir, "thread_history_1.sqlite"),
    modelsCache: path.join(baseDir, "models_cache.json"),
  };
}

export interface ProjectEntry {
  id: string;
  name: string;
}

export interface ThreadEntry {
  id: string;
  title: string;
  model: string;
  reasoningEffort: string;
  cwd: string;
  tokensUsed: number | null;
  threadSource: string;
  archived: boolean;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TurnRow {
  turnId: string;
  status: string;
  durationMs: number | null;
  startedAt: string;
  completedAt: string;
}

export interface CatalogEntry {
  slug: string;
  displayName: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
  effectivePercent: number | null;
}

function openReadOnly(dbPath: string): DatabaseSync | null {
  try {
    if (!fs.existsSync(dbPath)) return null;
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function listProjects(base: CodexBase): ProjectEntry[] {
  const db = openReadOnly(base.stateDb);
  if (!db) return [];
  try {
    const rows = db
      .prepare("SELECT id, name FROM projects ORDER BY position, name")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: str(r["id"]), name: str(r["name"]) }));
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function listThreads(base: CodexBase, limit: number): ThreadEntry[] {
  const db = openReadOnly(base.stateDb);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        "SELECT id, title, model, reasoning_effort, cwd, tokens_used, " +
          "thread_source, archived, project_id, created_at, updated_at " +
          "FROM threads ORDER BY updated_at_ms DESC LIMIT ?",
      )
      .all(Math.max(1, Math.min(500, limit))) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: str(r["id"]),
      title: str(r["title"]),
      model: str(r["model"]),
      reasoningEffort: str(r["reasoning_effort"]),
      cwd: str(r["cwd"]),
      tokensUsed: numOrNull(r["tokens_used"]),
      threadSource: str(r["thread_source"]),
      archived: (r["archived"] as number) === 1,
      projectId: str(r["project_id"]),
      createdAt: str(r["created_at"]),
      updatedAt: str(r["updated_at"]),
    }));
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function threadTurns(base: CodexBase, threadId: string): TurnRow[] {
  const db = openReadOnly(base.historyDb);
  if (!db || !threadId) return [];
  try {
    const rows = db
      .prepare(
        "SELECT turn_id, status, duration_ms, started_at, completed_at " +
          "FROM thread_turns WHERE thread_id = ? ORDER BY started_at",
      )
      .all(threadId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      turnId: str(r["turn_id"]),
      status: str(r["status"]),
      durationMs: numOrNull(r["duration_ms"]),
      startedAt: str(r["started_at"]),
      completedAt: str(r["completed_at"]),
    }));
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function readCatalog(base: CodexBase): CatalogEntry[] {
  try {
    const raw = fs.readFileSync(base.modelsCache, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const dict = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<
      string,
      unknown
    >;
    const models = Array.isArray(dict["models"]) ? dict["models"] : [];
    const out: CatalogEntry[] = [];
    for (const m of models) {
      if (typeof m !== "object" || m === null) continue;
      const spec = m as Record<string, unknown>;
      out.push({
        slug: str(spec["slug"]),
        displayName: str(spec["display_name"]),
        contextWindow: numOrNull(spec["context_window"]),
        maxContextWindow: numOrNull(spec["max_context_window"]),
        effectivePercent: numOrNull(spec["effective_context_window_percent"]),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function filesPresent(base: CodexBase): Record<string, boolean> {
  return {
    stateDb: fs.existsSync(base.stateDb),
    historyDb: fs.existsSync(base.historyDb),
    modelsCache: fs.existsSync(base.modelsCache),
  };
}
