"use strict";
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
exports.TURNS_CACHE_SECONDS = exports.DEFAULT_BIND = exports.DEFAULT_PORT = exports.VERSION = void 0;
exports.buildTurnsView = buildTurnsView;
exports.scanFileUsage = scanFileUsage;
exports.buildReviewsView = buildReviewsView;
exports.buildAggregateView = buildAggregateView;
exports.listSessions = listSessions;
exports.startServer = startServer;
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const types_1 = require("./collector/types");
const classify_1 = require("./collector/classify");
const snapshot_1 = require("./collector/snapshot");
const tail_1 = require("./collector/tail");
const codexdb_1 = require("./codexdb");
exports.VERSION = "0.6.0";
exports.DEFAULT_PORT = 8765;
exports.DEFAULT_BIND = "127.0.0.1";
exports.TURNS_CACHE_SECONDS = 30;
function walkRollouts(sessionsRoot) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                walk(full);
            else if (entry.isFile() &&
                entry.name.startsWith("rollout-") &&
                entry.name.endsWith(".jsonl")) {
                out.push(full);
            }
        }
    };
    walk(sessionsRoot);
    return out;
}
function buildTurnsView(state) {
    const out = [];
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
// Sums token_usage_record usage per file. Streaming + needle prefilter, so
// even hundred-MB auxiliary rollouts scan in seconds. On demand only.
function scanFileUsage(filePath) {
    const acc = { input: 0, cached: 0, output: 0, reasoning: 0, events: 0 };
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
    }
    catch {
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
            if (n <= 0)
                break;
            offset += n;
            const text = carry + buf.subarray(0, n).toString("utf8");
            const parts = text.split("\n");
            carry = parts.pop() ?? "";
            for (const line of parts) {
                if (!line.includes('"token_usage_record"'))
                    continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj["type"] !== "token_usage_record")
                        continue;
                    const payload = obj["payload"];
                    if (typeof payload !== "object" || payload === null)
                        continue;
                    const usage = payload["usage"];
                    if (typeof usage !== "object" || usage === null)
                        continue;
                    const u = usage;
                    const num = (k) => typeof u[k] === "number" ? u[k] : 0;
                    acc.input += num("input_tokens");
                    acc.cached += num("cached_input_tokens");
                    acc.output += num("output_tokens");
                    acc.reasoning += num("reasoning_output_tokens");
                    acc.events += 1;
                }
                catch {
                    // ignore malformed lines
                }
            }
        }
    }
    catch {
        // ignore read errors mid-scan
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch {
            // ignore
        }
    }
    return acc;
}
function buildUsageView(sessionsRoot, kinds) {
    const files = [];
    let totalInput = 0;
    let totalCached = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    for (const full of walkRollouts(sessionsRoot)) {
        let kind;
        try {
            kind = (0, classify_1.classifyRollout)(full);
        }
        catch {
            continue;
        }
        if (!kinds.includes(kind))
            continue;
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
function buildReviewsView(sessionsRoot) {
    return buildUsageView(sessionsRoot, ["auxiliary"]);
}
function buildAggregateView(sessionsRoot) {
    return buildUsageView(sessionsRoot, ["primary", "unknown"]);
}
function listSessions(sessionsRoot) {
    const entries = [];
    for (const full of walkRollouts(sessionsRoot)) {
        try {
            const st = fs.statSync(full);
            entries.push({
                id: path.basename(full),
                kind: (0, classify_1.classifyRollout)(full),
                mtimeMs: st.mtimeMs,
                size: st.size,
            });
        }
        catch {
            // ignore disappearing files
        }
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries;
}
class Tracker {
    sessionsRoot;
    explicitFile;
    rescanSeconds;
    state = (0, types_1.initialState)();
    cursor = (0, tail_1.newCursor)();
    lastScan = 0;
    startedAt = Date.now();
    turnsCache = [];
    turnsAt = 0;
    reviewsCache = null;
    aggregateCache = null;
    pinned = null;
    constructor(sessionsRoot, explicitFile, rescanSeconds) {
        this.sessionsRoot = sessionsRoot;
        this.explicitFile = explicitFile;
        this.rescanSeconds = rescanSeconds;
        this.tick(true);
        if (this.state.file === null && this.explicitFile) {
            this.state.file = this.explicitFile;
        }
        if (this.explicitFile) {
            this.pinned = this.state.file;
        }
    }
    switchTo(id) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/.test(id))
            return false;
        let target = null;
        for (const full of walkRollouts(this.sessionsRoot)) {
            if (path.basename(full) === id) {
                target = full;
                break;
            }
        }
        if (target === null || target === this.state.file)
            return target !== null;
        this.state = (0, types_1.initialState)();
        this.cursor = (0, tail_1.newCursor)();
        (0, tail_1.scanFullFile)(target, this.state, this.cursor);
        this.state.file = target;
        this.pinned = target;
        this.turnsCache = [];
        this.turnsAt = 0;
        this.lastScan = Date.now() / 1000;
        return true;
    }
    tick(force = false) {
        const now = Date.now() / 1000;
        if (force || now - this.lastScan >= this.rescanSeconds) {
            this.lastScan = now;
            if (this.pinned !== null && !fs.existsSync(this.pinned)) {
                this.pinned = null;
            }
            if (this.pinned === null) {
                const newest = (0, classify_1.newestRollout)(this.sessionsRoot, this.explicitFile);
                if (newest !== null && newest !== this.state.file) {
                    this.state = (0, types_1.initialState)();
                    this.cursor = (0, tail_1.newCursor)();
                    (0, tail_1.scanFullFile)(newest, this.state, this.cursor);
                    this.state.file = newest;
                    this.turnsCache = [];
                    this.turnsAt = 0;
                }
            }
        }
        if (this.state.file !== null) {
            (0, tail_1.readNew)(this.state.file, this.state, this.cursor);
        }
    }
}
function sendJson(res, code, body) {
    const text = JSON.stringify(body);
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
}
function sendFile(res, filePath, contentType) {
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
const STATIC_EXT = {
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
function sendAppStatic(res, appDir, pathname) {
    const rel = path.normalize(pathname).replace(/^[/\\]+/, "");
    const full = path.join(appDir, rel);
    const outside = path.relative(appDir, full).startsWith("..") || path.isAbsolute(path.relative(appDir, full));
    if (rel === "" || outside)
        return false;
    const ext = path.extname(full).toLowerCase();
    const contentType = STATIC_EXT[ext];
    if (!contentType)
        return false;
    let st;
    try {
        st = fs.statSync(full);
    }
    catch {
        return false;
    }
    if (!st.isFile())
        return false;
    const realApp = fs.realpathSync(appDir);
    const realFull = fs.realpathSync(full);
    if (realFull !== realApp && !realFull.startsWith(realApp + path.sep))
        return false;
    sendFile(res, full, contentType);
    return true;
}
function startServer(opts) {
    // Rare cadence by design: usage events are minutes apart; countdowns and
    // LIVE/IDLE render client-side from event timestamps, so a 5 s tick loses
    // nothing while cutting traffic and re-renders 5x vs the 1 Hz reference.
    const rescanSeconds = opts.rescanSeconds ?? 15;
    const tickMs = opts.tickMs ?? 5000;
    const tracker = new Tracker(opts.sessionsRoot, opts.explicitFile, rescanSeconds);
    const clients = new Set();
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
                version: exports.VERSION,
                file: tracker.state.file ? path.basename(tracker.state.file) : null,
                pinned: tracker.pinned !== null,
                uptimeSec: Math.floor((Date.now() - tracker.startedAt) / 1000),
            });
            return;
        }
        if (pathname === "/api/snapshot" && req.method === "GET") {
            tracker.tick();
            sendJson(res, 200, (0, snapshot_1.buildSnapshot)(tracker.state));
            return;
        }
        if (pathname === "/api/sessions" && req.method === "GET") {
            sendJson(res, 200, listSessions(opts.sessionsRoot));
            return;
        }
        if (pathname === "/api/turns" && req.method === "GET") {
            const now = Date.now();
            const force = url.searchParams.get("refresh") === "1";
            if (force || now - tracker.turnsAt > exports.TURNS_CACHE_SECONDS * 1000) {
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
            req.on("data", (chunk) => {
                body += chunk.toString("utf8");
                if (body.length > 4096) {
                    req.destroy();
                }
            });
            req.on("end", () => {
                try {
                    const parsed = JSON.parse(body || "{}");
                    const id = typeof parsed === "object" && parsed !== null
                        ? String(parsed["id"] ?? "")
                        : "";
                    if (tracker.switchTo(id)) {
                        sendJson(res, 200, {
                            ok: true,
                            file: tracker.state.file ? path.basename(tracker.state.file) : null,
                        });
                    }
                    else {
                        sendJson(res, 404, { ok: false, error: "unknown session id" });
                    }
                }
                catch {
                    sendJson(res, 400, { ok: false, error: "bad request" });
                }
            });
            req.on("error", () => {
                try {
                    sendJson(res, 400, { ok: false, error: "bad request" });
                }
                catch {
                    // ignore
                }
            });
            return;
        }
        if (pathname === "/api/codex/status" && req.method === "GET") {
            const base = (0, codexdb_1.codexBaseFromSessions)(opts.sessionsRoot);
            sendJson(res, 200, { baseDir: base.baseDir, files: (0, codexdb_1.filesPresent)(base) });
            return;
        }
        if (pathname === "/api/codex/projects" && req.method === "GET") {
            sendJson(res, 200, (0, codexdb_1.listProjects)((0, codexdb_1.codexBaseFromSessions)(opts.sessionsRoot)));
            return;
        }
        if (pathname === "/api/codex/sessions" && req.method === "GET") {
            const limit = Number(url.searchParams.get("limit") ?? 200) || 200;
            sendJson(res, 200, (0, codexdb_1.listThreads)((0, codexdb_1.codexBaseFromSessions)(opts.sessionsRoot), limit));
            return;
        }
        if (pathname === "/api/codex/turns" && req.method === "GET") {
            const thread = url.searchParams.get("thread") ?? "";
            sendJson(res, 200, (0, codexdb_1.threadTurns)((0, codexdb_1.codexBaseFromSessions)(opts.sessionsRoot), thread));
            return;
        }
        if (pathname === "/api/codex/catalog" && req.method === "GET") {
            sendJson(res, 200, (0, codexdb_1.readCatalog)((0, codexdb_1.codexBaseFromSessions)(opts.sessionsRoot)));
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
            sendFile(res, fs.existsSync(appIndex)
                ? appIndex
                : path.join(opts.webDir, "stub.html"), "text/html; charset=utf-8");
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
        const frame = "data: " + JSON.stringify((0, snapshot_1.buildSnapshot)(tracker.state)) + "\n\n";
        for (const client of clients) {
            try {
                client.write(frame);
            }
            catch {
                clients.delete(client);
            }
        }
    }, tickMs);
    timer.unref();
    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(opts.port, opts.bind, () => {
            const addr = server.address();
            const port = typeof addr === "object" && addr !== null ? addr.port : opts.port;
            resolve({
                port,
                stop: () => new Promise((done) => {
                    clearInterval(timer);
                    for (const client of clients) {
                        try {
                            client.end();
                        }
                        catch {
                            // ignore
                        }
                    }
                    clients.clear();
                    server.close(() => done());
                }),
            });
        });
    });
}
