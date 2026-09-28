// Incremental rollout reader. Port of RolloutFollower._scan_full_file
// + read_new (codex_context_monitor.py, lines 786-881). Read-only:
// the file position and the unterminated-EOF fragment are kept in memory.

import * as fs from "fs";
import { CollectorState } from "./types";
import { lineMightMatter, parseJsonLine } from "./parse";

export interface TailCursor {
  position: number;
  partial: string;
}

export function newCursor(): TailCursor {
  return { position: 0, partial: "" };
}

/** Full replay from byte 0. Trailing unterminated fragment is kept, not parsed. */
export function scanFullFile(
  filePath: string,
  state: CollectorState,
  cursor: TailCursor,
): void {
  cursor.partial = "";
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    cursor.position = 0;
    cursor.partial = "";
    return;
  }
  try {
    const stat = fs.fstatSync(fd);
    const CHUNK = 1024 * 1024;
    let offset = 0;
    let carry = "";
    const buf = Buffer.alloc(CHUNK);
    while (offset < stat.size) {
      const toRead = Math.min(CHUNK, stat.size - offset);
      const n = fs.readSync(fd, buf, 0, toRead, offset);
      if (n <= 0) break;
      offset += n;
      const text = carry + buf.subarray(0, n).toString("utf8");
      const parts = text.split("\n");
      carry = parts.pop() ?? "";
      for (const line of parts) {
        if (lineMightMatter(line)) parseJsonLine(state, line);
      }
    }
    cursor.partial = carry;
    cursor.position = offset;
  } catch {
    cursor.position = 0;
    cursor.partial = "";
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

/** Read only bytes appended after cursor.position. Handles truncation. */
export function readNew(
  filePath: string,
  state: CollectorState,
  cursor: TailCursor,
): void {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  if (size < cursor.position) {
    scanFullFile(filePath, state, cursor);
    return;
  }
  if (size === cursor.position) return;

  let data: Buffer;
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return;
  }
  try {
    data = Buffer.alloc(size - cursor.position);
    fs.readSync(fd, data, 0, data.length, cursor.position);
    cursor.position = size;
  } catch {
    return;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
  const text = cursor.partial + data.toString("utf8");
  if (!text) return;
  const parts = text.split("\n");
  cursor.partial = parts.pop() ?? "";
  for (const line of parts) {
    if (lineMightMatter(line)) parseJsonLine(state, line.replace(/\r$/, ""));
  }
}
