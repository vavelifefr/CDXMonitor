// E2 HTTP server: stdlib node:http only. Routes:
//   GET /api/health   -> status + CORS * (polled by file:// boot page)
//   GET /api/snapshot -> current snapshot JSON (5 s data)
//   GET /api/sessions -> rollout list (id/kind/mtime/size, no paths)
//   GET /api/turns    -> per-turn aggregates (recomputed at most every 30 s)
//   GET /api/activity -> tool counters + context series
//   GET /api/reviews  -> auxiliary-rollout usage (on demand, cached)
//   GET /api/codex/*  -> read-only Codex SQLite/JSON (manual refresh, no polling)
//   GET /api/events   -> SSE snapshot tick (5 s)
//   GET /boot, /boot.html, /help, /help.html, /Statistic.html, /stub, /stub.html
//   GET /             -> built UI (fallback stub)

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { CollectorState, initialState } from "./collector/types";
import { classifyRollout, newestRollout } from "./collector/classify";
import { buildSnapshot } from "./collector/snapshot";
import { newCursor, readNew, scanFullFile, TailCursor } from "./collector/tail";
import {
  codexBaseFromSessions,
  filesPresent,
  listProjects,
  listThreads,
  readCatalog,
  threadTurns,
} from "./codexdb";
import {
  openHistory,
  queryHistory,
  recordObservation,
} from "./history";

export const VERSION = "0.7.0";
export const DEFAULT_PORT = 8765;
export const DEFAULT_BIND = "127.0.0.1";
export const TURNS_CACHE_SECONDS = 30;

export interface ServerOptions {
  port: number;
  bind: string;
  sessionsRoot: string;
  explicitFile: string | null;
  webDir: string;
  rescanSeconds?: number;
  tickMs?: number;
  dataDir?: string | null;
  historySeconds?: number;
}

export interface SessionEntry {
  id: string;
  kind: string;
  mtimeMs: number;
  size: number;
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
      if (entry.isDirectory()) walk(full);
      else if (
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

export interface TurnView {
  id: string;
  model: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  events: number;
  firstSeen: string;
  lastSeen: string;
}

export function buildTurnsView(state: CollectorState): TurnView[] {
  const out: TurnView[] = [];
  for (const [id, s] of state.turnStats) {
    out.push({
      id,
      model: state.turnModels.get(id) ?? "",
      input: s.input,
      cached: s.cached,
      output: s.output,
      reasoning: s.reasoning,
      events: s.events,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
    });
  }
  out.sort((a, b) => b.input - a.input);
  return out;
}

export interface ReviewUsage {
  id: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  events: number;
}

// Sums token_usage_record usage per file. Streaming + needle prefilter, so
// even hundred-MB auxiliary rollouts scan in seconds. On demand only.
export function scanFileUsage(filePath: string): {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  events: number;
} {
  const acc = { input: 0, cached: 0, output: 0, reasoning: 0, events: 0 };
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return acc;
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
        if (!line.includes('"token_usage_record"')) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj["type"] !== "token_usage_record") continue;
          const payload = obj["payload"];
          if (typeof payload !== "object" || payload === null) continue;
          const usage = (payload as Record<string, unknown>)["usage"];
          if (typeof usage !== "object" || usage === null) continue;
          const u = usage as Record<string, unknown>;
          const num = (k: string): number =>
            typeof u[k] === "number" ? (u[k] as number) : 0;
          acc.input += num("input_tokens");
          acc.cached += num("cached_input_tokens");
          acc.output += num("output_tokens");
          acc.reasoning += num("reasoning_output_tokens");
          acc.events += 1;
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch {
    // ignore read errors mid-scan
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
  return acc;
}

export interface ReviewsView {
  updatedAt: string;
  files: ReviewUsage[];
  totalInput: number;
  totalCached: number;
  totalOutput: number;
  totalReasoning: number;
}

function buildUsageView(
  sessionsRoot: string,
  kinds: string[],
): ReviewsView {
  const files: ReviewUsage[] = [];
  let totalInput = 0;
  let totalCached = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  for (const full of walkRollouts(sessionsRoot)) {
    let kind: string;
    try {
      kind = classifyRollout(full);
    } catch {
      continue;
    }
    if (!kinds.includes(kind)) continue;
    const u = scanFileUsage(full);
    files.push({
      id: path.basename(full),
      input: u.input,
      cached: u.cached,
      output: u.output,
      reasoning: u.reasoning,
      events: u.events,
    });
    totalInput += u.input;
    totalCached += u.cached;
    totalOutput += u.output;
    totalReasoning += u.reasoning;
  }
  files.sort((a, b) => b.input - a.input);
  return {
    updatedAt: new Date().toISOString(),
    files,
    totalInput,
    totalCached,
    totalOutput,
    totalReasoning,
  };
}

export function buildReviewsView(sessionsRoot: string): ReviewsView {
  return buildUsageView(sessionsRoot, ["auxiliary"]);
}

export function buildAggregateView(sessionsRoot: string): ReviewsView {
  return buildUsageView(sessionsRoot, ["primary", "unknown"]);
}

export function listSessions(sessionsRoot: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const full of walkRollouts(sessionsRoot)) {
    try {
      const st = fs.statSync(full);
      entries.push({
        id: path.basename(full),
        kind: classifyRollout(full),
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    } catch {
      // ignore disappearing files
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

class Tracker {
  state: CollectorState = initialState();
  cursor: TailCursor = newCursor();
  lastScan = 0;
  startedAt = Date.now();
  turnsCache: TurnView[] = [];
  turnsAt = 0;
  reviewsCache: ReviewsView | null = null;
  aggregateCache: ReviewsView | null = null;
  pinned: string | null = null;

  constructor(
    private sessionsRoot: string,
    private explicitFile: string | null,
    private rescanSeconds: number,
  ) {
    this.tick(true);
    if (this.state.file === null && this.explicitFile) {
      this.state.file = this.explicitFile;
    }
    if (this.explicitFile) {
      this.pinned = this.state.file;
    }
  }

  switchTo(id: string): boolean {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/.test(id)) return false;
    let target: string | null = null;
    for (const full of walkRollouts(this.sessionsRoot)) {
      if (path.basename(full) === id) {
        target = full;
        break;
      }
    }
    if (target === null || target === this.state.file) return target !== null;
    this.state = initialState();
    this.cursor = newCursor();
    scanFullFile(target, this.state, this.cursor);
    this.state.file = target;
    this.pinned = target;
    this.turnsCache = [];
    this.turnsAt = 0;
    this.lastScan = Date.now() / 1000;
    return true;
  }

  tick(force = false): void {
    const now = Date.now() / 1000;
    if (force || now - this.lastScan >= this.rescanSeconds) {
      this.lastScan = now;
      if (this.pinned !== null && !fs.existsSync(this.pinned)) {
        this.pinned = null;
      }
      if (this.pinned === null) {
        const newest = newestRollout(this.sessionsRoot, this.explicitFile);
        if (newest !== null && newest !== this.state.file) {
          this.state = initialState();
          this.cursor = newCursor();
          scanFullFile(newest, this.state, this.cursor);
          this.state.file = newest;
          this.turnsCache = [];
          this.turnsAt = 0;
        }
      }
    }
    if (this.state.file !== null) {
      readNew(this.state.file, this.state, this.cursor);
    }
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendFile(res: http.ServerResponse, filePath: string, contentType: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

const STATIC_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// E3: serve the built UI (web/app) with a realpath guard. Only allowlisted
// extensions inside the app dir; everything else (config, server, data) is
// never served.
function sendAppStatic(
  res: http.ServerResponse,
  appDir: string,
  pathname: string,
): boolean {
  const rel = path.normalize(pathname).replace(/^[/\\]+/, "");
  const full = path.join(appDir, rel);
  const outside =
    path.relative(appDir, full).startsWith("..") || path.isAbsolute(path.relative(appDir, full));
  if (rel === "" || outside) return false;
  const ext = path.extname(full).toLowerCase();
  const contentType = STATIC_EXT[ext];
  if (!contentType) return false;
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const realApp = fs.realpathSync(appDir);
  const realFull = fs.realpathSync(full);
  if (realFull !== realApp && !realFull.startsWith(realApp + path.sep)) return false;
  sendFile(res, full, contentType);
  return true;
}

export interface RunningServer {
  port: number;
  stop: () => Promise<void>;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  // Rare cadence by design: usage events are minutes apart; countdowns and
  // LIVE/IDLE render client-side from event timestamps, so a 5 s tick loses
  // nothing while cutting traffic and re-renders 5x vs the 1 Hz reference.
  const rescanSeconds = opts.rescanSeconds ?? 15;
  const tickMs = opts.tickMs ?? 5000;
  const tracker = new Tracker(opts.sessionsRoot, opts.explicitFile, rescanSeconds);
  const clients = new Set<http.ServerResponse>();
  const historyDb = openHistory(opts.dataDir ?? null);
  const historySeconds = opts.historySeconds ?? 60;
  const recordTick = (): void => {
    if (!historyDb) return;
    try {
      tracker.tick();
      recordObservation(historyDb, tracker.state);
    } catch {
      // history must never break the server
    }
  };
  if (historyDb) {
    recordTick();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });
      res.end();
      return;
    }
    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        version: VERSION,
        file: tracker.state.file ? path.basename(tracker.state.file) : null,
        pinned: tracker.pinned !== null,
        uptimeSec: Math.floor((Date.now() - tracker.startedAt) / 1000),
      });
      return;
    }
    if (pathname === "/api/snapshot" && req.method === "GET") {
      tracker.tick();
      sendJson(res, 200, buildSnapshot(tracker.state));
      return;
    }
    if (pathname === "/api/sessions" && req.method === "GET") {
      sendJson(res, 200, listSessions(opts.sessionsRoot));
      return;
    }
    if (pathname === "/api/turns" && req.method === "GET") {
      const now = Date.now();
      const force = url.searchParams.get("refresh") === "1";
      if (force || now - tracker.turnsAt > TURNS_CACHE_SECONDS * 1000) {
        tracker.turnsCache = buildTurnsView(tracker.state);
        tracker.turnsAt = now;
      }
      sendJson(res, 200, {
        updatedAt: new Date(tracker.turnsAt).toISOString(),
        turns: tracker.turnsCache,
      });
      return;
    }
    if (pathname === "/api/activity" && req.method === "GET") {
      tracker.tick();
      sendJson(res, 200, {
        tools: tracker.state.toolCalls,
        series: tracker.state.series.slice(-240),
        compaction: tracker.state.compaction.count,
      });
      return;
    }
    if (pathname === "/api/reviews" && req.method === "GET") {
      const force = url.searchParams.get("refresh") === "1";
      if (force || tracker.reviewsCache === null) {
        tracker.reviewsCache = buildReviewsView(opts.sessionsRoot);
      }
      sendJson(res, 200, tracker.reviewsCache);
      return;
    }
    if (pathname === "/api/aggregate" && req.method === "GET") {
      const force = url.searchParams.get("refresh") === "1";
      if (force || tracker.aggregateCache === null) {
        tracker.aggregateCache = buildAggregateView(opts.sessionsRoot);
      }
      sendJson(res, 200, tracker.aggregateCache);
      return;
    }
    if (pathname === "/api/active" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length > 4096) {
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(body || "{}");
          const id =
            typeof parsed === "object" && parsed !== null
              ? String((parsed as Record<string, unknown>)["id"] ?? "")
              : "";
          if (tracker.switchTo(id)) {
            sendJson(res, 200, {
              ok: true,
              file: tracker.state.file ? path.basename(tracker.state.file) : null,
            });
          } else {
            sendJson(res, 404, { ok: false, error: "unknown session id" });
          }
        } catch {
          sendJson(res, 400, { ok: false, error: "bad request" });
        }
      });
      req.on("error", () => {
        try {
          sendJson(res, 400, { ok: false, error: "bad request" });
        } catch {
          // ignore
        }
      });
      return;
    }
    if (pathname === "/api/codex/status" && req.method === "GET") {
      const base = codexBaseFromSessions(opts.sessionsRoot);
      sendJson(res, 200, { baseDir: base.baseDir, files: filesPresent(base) });
      return;
    }
    if (pathname === "/api/codex/projects" && req.method === "GET") {
      sendJson(res, 200, listProjects(codexBaseFromSessions(opts.sessionsRoot)));
      return;
    }
    if (pathname === "/api/codex/sessions" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 200) || 200;
      sendJson(res, 200, listThreads(codexBaseFromSessions(opts.sessionsRoot), limit));
      return;
    }
    if (pathname === "/api/codex/turns" && req.method === "GET") {
      const thread = url.searchParams.get("thread") ?? "";
      sendJson(res, 200, threadTurns(codexBaseFromSessions(opts.sessionsRoot), thread));
      return;
    }
    if (pathname === "/api/codex/catalog" && req.method === "GET") {
      sendJson(res, 200, readCatalog(codexBaseFromSessions(opts.sessionsRoot)));
      return;
    }
    if (pathname === "/api/history" && req.method === "GET") {
      if (!historyDb) {
        sendJson(res, 200, { available: false, points: [] });
        return;
      }
      const range = url.searchParams.get("range") === "week" ? "week" : "day";
      const spanMs = range === "week" ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
      try {
        tracker.tick();
        recordObservation(historyDb, tracker.state);
        sendJson(res, 200, {
          available: true,
          range,
          points: queryHistory(historyDb, Date.now() - spanMs, 300),
        });
      } catch {
        sendJson(res, 200, { available: false, points: [] });
      }
      return;
    }
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }
    // .html aliases: the same relative links work via file:// and over HTTP.
    if ((pathname === "/boot" || pathname === "/boot.html") && req.method === "GET") {
      sendFile(res, path.join(opts.webDir, "boot.html"), "text/html; charset=utf-8");
      return;
    }
    if ((pathname === "/help" || pathname === "/help.html") && req.method === "GET") {
      sendFile(res, path.join(opts.webDir, "help.html"), "text/html; charset=utf-8");
      return;
    }
    if (pathname === "/Statistic.html" && req.method === "GET") {
      sendFile(res, path.join(opts.webDir, "Statistic.html"), "text/html; charset=utf-8");
      return;
    }
    if (pathname === "/stub.html" && req.method === "GET") {
      sendFile(res, path.join(opts.webDir, "stub.html"), "text/html; charset=utf-8");
      return;
    }
    if (pathname === "/stub" && req.method === "GET") {
      sendFile(res, path.join(opts.webDir, "stub.html"), "text/html; charset=utf-8");
      return;
    }
    if ((pathname === "/" || pathname === "/index.html") && req.method === "GET") {
      const appIndex = path.join(opts.webDir, "app", "index.html");
      sendFile(
        res,
        fs.existsSync(appIndex)
          ? appIndex
          : path.join(opts.webDir, "stub.html"),
        "text/html; charset=utf-8",
      );
      return;
    }
    if (req.method === "GET" && sendAppStatic(res, path.join(opts.webDir, "app"), pathname)) {
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  const timer = setInterval(() => {
    tracker.tick();
    const frame = "data: " + JSON.stringify(buildSnapshot(tracker.state)) + "\n\n";
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  }, tickMs);
  timer.unref();
  const historyTimer = setInterval(recordTick, Math.max(1, historySeconds) * 1000);
  historyTimer.unref();

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, opts.bind, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : opts.port;
      resolve({
        port,
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            clearInterval(historyTimer);
            for (const client of clients) {
              try {
                client.end();
              } catch {
                // ignore
              }
            }
            clients.clear();
            try {
              if (historyDb) historyDb.close();
            } catch {
              // ignore
            }
            server.close(() => done());
          }),
      });
    });
  });
}
