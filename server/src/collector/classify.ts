// Rollout discovery and primary/auxiliary classification.
// Port of classify_rollout + RolloutFollower.newest_rollout
// (codex_context_monitor.py, lines 643-784). Read-only.

import * as fs from "fs";
import * as path from "path";
import { asDict } from "./types";

export type RolloutKind = "primary" | "auxiliary" | "unknown";

export function classifyRollout(filePath: string): RolloutKind {
  let sawUserSource = false;
  let sawParent = false;
  let sawAutoReview = false;
  let sawVscodeSource = false;

  let fd: number | null = null;
  try {
    const content = readFirstLines(filePath, 256);
    for (const raw of content) {
      if (
        !raw.includes('"session_meta"') &&
        !raw.includes('"thread_source"') &&
        !raw.includes('"parent_thread_id"') &&
        !raw.includes('"codex-auto-review"') &&
        !raw.includes('"source"')
      ) {
        continue;
      }
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof obj !== "object" || obj === null) continue;
      const rec = obj as Record<string, unknown>;
      const payload = asDict(rec["payload"]);
      if (!payload) continue;

      if (payload["thread_source"] === "user") sawUserSource = true;
      if (payload["parent_thread_id"]) sawParent = true;
      if (payload["source"] === "vscode") sawVscodeSource = true;

      const candidates: unknown[] = [payload["model"]];
      const state = asDict(payload["state"]);
      candidates.push(state ? state["model"] : null);
      const collab = asDict(payload["collaboration_mode"]);
      const settings = collab ? asDict(collab["settings"]) : null;
      candidates.push(settings ? settings["model"] : null);

      if (candidates.includes("codex-auto-review")) sawAutoReview = true;
      if (sawParent || sawAutoReview) return "auxiliary";
      if (sawUserSource) return "primary";
    }
  } catch {
    return "unknown";
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }

  if (sawParent || sawAutoReview) return "auxiliary";
  if (sawUserSource || sawVscodeSource) return "primary";
  return "unknown";
}

function readFirstLines(filePath: string, maxLines: number): string[] {
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 1024 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    const text = buf.toString("utf8");
    return text.split("\n").slice(0, maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function walkRollouts(sessionsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        out.push(full);
      }
    }
  };
  walk(sessionsRoot);
  return out;
}

export function newestRollout(
  sessionsRoot: string,
  explicitFile: string | null,
  classify: (p: string) => RolloutKind = classifyRollout,
): string | null {
  if (explicitFile) {
    return fs.existsSync(explicitFile) ? explicitFile : null;
  }
  if (!fs.existsSync(sessionsRoot)) return null;

  const withMtime: Array<{ mtime: number; p: string }> = [];
  for (const p of walkRollouts(sessionsRoot)) {
    try {
      withMtime.push({ mtime: fs.statSync(p).mtimeMs, p });
    } catch {
      // ignore disappearing files
    }
  }
  if (withMtime.length === 0) return null;
  withMtime.sort((a, b) => b.mtime - a.mtime);

  let newestUnknown: string | null = null;
  for (const { p } of withMtime.slice(0, 32)) {
    const kind = classify(p);
    if (kind === "primary") return p;
    if (kind === "unknown" && newestUnknown === null) newestUnknown = p;
  }
  return newestUnknown;
}

export function defaultSessionsRoot(): string {
  const home = process.env["CODEX_HOME"];
  if (home) return path.join(home, "sessions");
  const userProfile = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "";
  return path.join(userProfile, ".codex", "sessions");
}
