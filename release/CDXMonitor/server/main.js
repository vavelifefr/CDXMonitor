"use strict";
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
// Entry point: node main.js [--config PATH] [--port N] [--bind ADDR]
// [--file PATH | --sessions ROOT] [--web-dir DIR] [--data-dir DIR] [--pid-file PATH]
// CLI flags override the JSON config file. Read-only wrt Codex data.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const server_1 = require("./server");
const classify_1 = require("./collector/classify");
function parseArgs(argv) {
    const out = {
        config: null, port: null, bind: null, file: null,
        sessions: null, webDir: null, dataDir: null, pidFile: null, logFile: null,
    };
    const takesValue = new Set([
        "--config", "--port", "--bind", "--file",
        "--sessions", "--web-dir", "--data-dir", "--pid-file", "--log-file",
    ]);
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = (i + 1 < argv.length ? argv[i + 1] : null);
        if (!takesValue.has(flag) || next === null)
            continue;
        if (flag === "--config")
            out.config = next;
        if (flag === "--port") {
            const n = Number(next);
            out.port = Number.isFinite(n) && n >= 0 ? n : null;
        }
        if (flag === "--bind")
            out.bind = next;
        if (flag === "--file")
            out.file = next;
        if (flag === "--sessions")
            out.sessions = next;
        if (flag === "--web-dir")
            out.webDir = next;
        if (flag === "--data-dir")
            out.dataDir = next;
        if (flag === "--pid-file")
            out.pidFile = next;
        if (flag === "--log-file")
            out.logFile = next;
        i++;
    }
    return out;
}
function loadConfig(configPath) {
    if (!configPath)
        return {};
    let raw;
    try {
        raw = fs.readFileSync(configPath, "utf8");
    }
    catch (err) {
        throw new Error("cannot read config " + configPath + ": " + String(err));
    }
    let parsed;
    try {
        // Tolerate a leading BOM: editors often save JSON with one, and the
        // project policy itself mandates BOM for text files.
        parsed = JSON.parse(raw.replace(/^﻿/, ""));
    }
    catch (err) {
        throw new Error("bad JSON in " + configPath + ": " + String(err));
    }
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("bad JSON in " + configPath + ": top-level object expected");
    }
    return parsed;
}
function resolveWebDir() {
    // dev layout: dist/src/main.js -> ../../web; release layout: server/main.js -> ../web.
    const candidates = [
        path.resolve(__dirname, "..", "..", "web"),
        path.resolve(__dirname, "..", "web"),
    ];
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isDirectory())
                return c;
        }
        catch {
            // try next
        }
    }
    return candidates[0];
}
function logLine(logFile, msg) {
    if (!logFile)
        return;
    try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.appendFileSync(logFile, new Date().toISOString() + " " + msg + "\n", "utf8");
    }
    catch {
        // logging must never crash the server
    }
}
function removePidFile(pidFile) {
    if (!pidFile)
        return;
    try {
        fs.unlinkSync(pidFile);
    }
    catch {
        // best effort
    }
}
// Single-instance guards. Node sets SO_REUSEADDR, so on Windows two servers
// can silently share one port; lock files make the second instance fail loudly
// instead. Stale locks (taskkill /F skips exit hooks) are taken over after a
// liveness check. Guards: per data dir AND global per port (port 0 = ephemeral,
// no global guard).
function acquireOneLock(lockPath, label) {
    const dir = path.dirname(lockPath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch {
        // ignore
    }
    const release = () => {
        try {
            if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
                fs.unlinkSync(lockPath);
            }
        }
        catch {
            // best effort
        }
    };
    const claim = () => {
        fs.writeFileSync(lockPath, String(process.pid), "utf8");
        process.on("exit", release);
    };
    try {
        const fd = fs.openSync(lockPath, "wx");
        fs.writeFileSync(fd, String(process.pid));
        fs.closeSync(fd);
        process.on("exit", () => {
            try {
                fs.unlinkSync(lockPath);
            }
            catch {
                // best effort
            }
        });
        return;
    }
    catch (err) {
        if (err?.code !== "EEXIST")
            throw err;
    }
    let owner = 0;
    try {
        owner = Number(fs.readFileSync(lockPath, "utf8").trim()) || 0;
    }
    catch {
        // unreadable: try to take over below
    }
    let alive = false;
    if (owner > 0 && owner !== process.pid) {
        try {
            process.kill(owner, 0);
            alive = true;
        }
        catch {
            alive = false;
        }
    }
    if (alive) {
        throw new Error("CDXMonitor already running (" + label + ", pid " + String(owner) +
            "). Stop it with stop.cmd first.");
    }
    claim();
}
function acquireLock(dataDir, port) {
    if (dataDir) {
        acquireOneLock(path.join(dataDir, "server.lock"), "data dir");
    }
    if (port !== 0) {
        const tmp = process.env["TEMP"] ?? process.env["TMP"] ?? ".";
        acquireOneLock(path.join(tmp, "cdxmonitor-port-" + String(port) + ".lock"), "port " + String(port));
    }
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const fileConf = loadConfig(args.config);
    const numOrNull = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
    const strOrNull = (v) => typeof v === "string" && v ? v : null;
    const port = args.port ?? numOrNull(fileConf.port) ?? server_1.DEFAULT_PORT;
    const bind = args.bind ?? strOrNull(fileConf.bind) ?? server_1.DEFAULT_BIND;
    const sessionsRoot = args.sessions ?? strOrNull(fileConf.sessions) ?? (0, classify_1.defaultSessionsRoot)();
    const dataDir = args.dataDir ?? strOrNull(fileConf.dataDir) ?? null;
    const pidFile = args.pidFile ?? strOrNull(fileConf.pidFile) ?? null;
    const logFile = args.logFile ?? strOrNull(fileConf.logFile) ?? null;
    const webDir = args.webDir ?? resolveWebDir();
    if (dataDir) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    try {
        acquireLock(dataDir, port);
    }
    catch (err) {
        process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
        logLine(logFile, "startup refused: " + String(err instanceof Error ? err.message : err));
        process.exit(1);
    }
    let running;
    try {
        running = await (0, server_1.startServer)({
            port,
            bind,
            sessionsRoot,
            explicitFile: args.file,
            webDir,
            dataDir,
        });
    }
    catch (err) {
        const code = err?.code;
        if (code === "EADDRINUSE") {
            process.stderr.write("CDXMonitor: port " + String(port) + " is already occupied (" +
                bind + ":" + String(port) + "). Stop the other instance or use --port N.\n");
            logLine(logFile, "startup failed: port " + String(port) + " occupied");
        }
        else {
            process.stderr.write("CDXMonitor startup failed: " + String(err) + "\n");
            logLine(logFile, "startup failed: " + String(err));
        }
        process.exit(1);
    }
    if (pidFile) {
        fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid), "utf8");
    }
    const listenMsg = "listening on http://" + bind + ":" + String(running.port) + "/ pid=" + String(process.pid);
    process.stdout.write("CDXMonitor v0.7.0 on http://" + bind + ":" + String(running.port) + "/\n");
    logLine(logFile, listenMsg);
    const shutdown = () => {
        void running.stop().then(() => {
            removePidFile(pidFile);
            logLine(logFile, "stopped");
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("uncaughtException", (err) => {
        logLine(logFile, "fatal: " + String(err));
        process.stderr.write("CDXMonitor fatal: " + String(err) + "\n");
        process.exit(1);
    });
    return 0;
}
main().then(() => undefined, (err) => {
    process.stderr.write("startup failed: " + String(err) + "\n");
    process.exit(1);
});
