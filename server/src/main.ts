// Entry point: node main.js [--config PATH] [--port N] [--bind ADDR]
// [--file PATH | --sessions ROOT] [--web-dir DIR] [--data-dir DIR] [--pid-file PATH]
// CLI flags override the JSON config file. Read-only wrt Codex data.
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_BIND, DEFAULT_PORT, startServer } from "./server";
import { defaultSessionsRoot } from "./collector/classify";

interface CliArgs {
  config: string | null;
  port: number | null;
  bind: string | null;
  file: string | null;
  sessions: string | null;
  webDir: string | null;
  dataDir: string | null;
  pidFile: string | null;
  logFile: string | null;
}

interface FileConfig {
  port?: unknown;
  bind?: unknown;
  sessions?: unknown;
  dataDir?: unknown;
  pidFile?: unknown;
  logFile?: unknown;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    config: null, port: null, bind: null, file: null,
    sessions: null, webDir: null, dataDir: null, pidFile: null, logFile: null,
  };
  const takesValue = new Set([
    "--config", "--port", "--bind", "--file",
    "--sessions", "--web-dir", "--data-dir", "--pid-file", "--log-file",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    const next = (i + 1 < argv.length ? argv[i + 1] : null) as string | null;
    if (!takesValue.has(flag) || next === null) continue;
    if (flag === "--config") out.config = next;
    if (flag === "--port") {
      const n = Number(next);
      out.port = Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (flag === "--bind") out.bind = next;
    if (flag === "--file") out.file = next;
    if (flag === "--sessions") out.sessions = next;
    if (flag === "--web-dir") out.webDir = next;
    if (flag === "--data-dir") out.dataDir = next;
    if (flag === "--pid-file") out.pidFile = next;
    if (flag === "--log-file") out.logFile = next;
    i++;
  }
  return out;
}

function loadConfig(configPath: string | null): FileConfig {
  if (!configPath) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err: unknown) {
    throw new Error("cannot read config " + configPath + ": " + String(err));
  }
  let parsed: unknown;
  try {
    // Tolerate a leading BOM: editors often save JSON with one, and the
    // project policy itself mandates BOM for text files.
    parsed = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (err: unknown) {
    throw new Error("bad JSON in " + configPath + ": " + String(err));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("bad JSON in " + configPath + ": top-level object expected");
  }
  return parsed as FileConfig;
}

function resolveWebDir(): string {
  // dev layout: dist/src/main.js -> ../../web; release layout: server/main.js -> ../web.
  const candidates = [
    path.resolve(__dirname, "..", "..", "web"),
    path.resolve(__dirname, "..", "web"),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      // try next
    }
  }
  return candidates[0] as string;
}

function logLine(logFile: string | null, msg: string): void {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, new Date().toISOString() + " " + msg + "\n", "utf8");
  } catch {
    // logging must never crash the server
  }
}

function removePidFile(pidFile: string | null): void {
  if (!pidFile) return;
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // best effort
  }
}

// Single-instance guards. Node sets SO_REUSEADDR, so on Windows two servers
// can silently share one port; lock files make the second instance fail loudly
// instead. Stale locks (taskkill /F skips exit hooks) are taken over after a
// liveness check. Guards: per data dir AND global per port (port 0 = ephemeral,
// no global guard).
function acquireOneLock(lockPath: string, label: string): void {
  const dir = path.dirname(lockPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const release = (): void => {
    try {
      if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // best effort
    }
  };
  const claim = (): void => {
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
      } catch {
        // best effort
      }
    });
    return;
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code !== "EEXIST") throw err;
  }
  let owner = 0;
  try {
    owner = Number(fs.readFileSync(lockPath, "utf8").trim()) || 0;
  } catch {
    // unreadable: try to take over below
  }
  let alive = false;
  if (owner > 0 && owner !== process.pid) {
    try {
      process.kill(owner, 0);
      alive = true;
    } catch {
      alive = false;
    }
  }
  if (alive) {
    throw new Error(
      "CDXMonitor already running (" + label + ", pid " + String(owner) +
      "). Stop it with stop.cmd first.");
  }
  claim();
}

function acquireLock(dataDir: string | null, port: number): void {
  if (dataDir) {
    acquireOneLock(path.join(dataDir, "server.lock"), "data dir");
  }
  if (port !== 0) {
    const tmp = process.env["TEMP"] ?? process.env["TMP"] ?? ".";
    acquireOneLock(path.join(tmp, "cdxmonitor-port-" + String(port) + ".lock"),
      "port " + String(port));
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const fileConf = loadConfig(args.config);
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;

  const port = args.port ?? numOrNull(fileConf.port) ?? DEFAULT_PORT;
  const bind = args.bind ?? strOrNull(fileConf.bind) ?? DEFAULT_BIND;
  const sessionsRoot = args.sessions ?? strOrNull(fileConf.sessions) ?? defaultSessionsRoot();
  const dataDir = args.dataDir ?? strOrNull(fileConf.dataDir) ?? null;
  const pidFile = args.pidFile ?? strOrNull(fileConf.pidFile) ?? null;
  const logFile = args.logFile ?? strOrNull(fileConf.logFile) ?? null;
  const webDir = args.webDir ?? resolveWebDir();

  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  try {
    acquireLock(dataDir, port);
  } catch (err: unknown) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    logLine(logFile, "startup refused: " + String(err instanceof Error ? err.message : err));
    process.exit(1);
  }

  let running;
  try {
    running = await startServer({
      port,
      bind,
      sessionsRoot,
      explicitFile: args.file,
      webDir,
      dataDir,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "EADDRINUSE") {
      process.stderr.write(
        "CDXMonitor: port " + String(port) + " is already occupied (" +
        bind + ":" + String(port) + "). Stop the other instance or use --port N.\n");
      logLine(logFile, "startup failed: port " + String(port) + " occupied");
    } else {
      process.stderr.write("CDXMonitor startup failed: " + String(err) + "\n");
      logLine(logFile, "startup failed: " + String(err));
    }
    process.exit(1);
  }
  if (pidFile) {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid), "utf8");
  }
  const listenMsg =
    "listening on http://" + bind + ":" + String(running.port) + "/ pid=" + String(process.pid);
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
  process.on("uncaughtException", (err: unknown) => {
    logLine(logFile, "fatal: " + String(err));
    process.stderr.write("CDXMonitor fatal: " + String(err) + "\n");
    process.exit(1);
  });
  return 0;
}

main().then(
  () => undefined,
  (err: unknown) => {
    process.stderr.write("startup failed: " + String(err) + "\n");
    process.exit(1);
  },
);
