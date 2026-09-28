// E2 server tests. Synthetic sessions only; ephemeral port; loopback only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "fs";
import * as net from "node:net";
import * as os from "os";
import * as path from "path";
import { RunningServer, startServer } from "../src/server";
import { sessionMeta, taskEvent, toJsonl, usageRecord } from "./fixtures";

let running: RunningServer | null = null;
let base = "";
let sessionsDir = "";

before(async () => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-srv-"));
  fs.writeFileSync(
    path.join(sessionsDir, "rollout-test.jsonl"),
    toJsonl([
      sessionMeta({ threadSource: "user", model: "gpt-6-sol" }),
      taskEvent("task_started", "t1"),
      usageRecord({ input: 1000, cached: 800, output: 100, reasoning: 20 }),
    ]),
    "utf8",
  );
  const realWeb = path.resolve(__dirname, "..", "..", "web");
  // Hermetic web dir: boot + stub copies, no app/ (fallback deterministic).
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-web-"));
  fs.copyFileSync(path.join(realWeb, "boot.html"), path.join(webDir, "boot.html"));
  fs.copyFileSync(path.join(realWeb, "stub.html"), path.join(webDir, "stub.html"));
  fs.copyFileSync(path.join(realWeb, "help.html"), path.join(webDir, "help.html"));
  fs.copyFileSync(path.join(realWeb, "Statistic.html"), path.join(webDir, "Statistic.html"));
  running = await startServer({
    port: 0,
    bind: "127.0.0.1",
    sessionsRoot: sessionsDir,
    explicitFile: null,
    webDir,
    tickMs: 50,
  });
  base = "http://127.0.0.1:" + String(running.port);
});

after(async () => {
  if (running) await running.stop();
});

describe("http api", () => {
  it("health reports ok with CORS for the boot page", async () => {
    const res = await fetch(base + "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["status"], "ok");
    assert.equal(body["file"], "rollout-test.jsonl");
  });

  it("snapshot exposes collector numbers", async () => {
    const res = await fetch(base + "/api/snapshot");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      model: string;
      turn: { input: number; output: number };
    };
    assert.equal(body.model, "gpt-6-sol");
    assert.equal(body.turn.input, 1000);
    assert.equal(body.turn.output, 100);
  });

  it("sessions lists the synthetic rollout as primary", async () => {
    const res = await fetch(base + "/api/sessions");
    const body = (await res.json()) as Array<{
      id: string;
      kind: string;
    }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]?.id, "rollout-test.jsonl");
    assert.equal(body[0]?.kind, "primary");
  });

  it("serves boot, help and stub pages", async () => {
    const boot = await fetch(base + "/boot");
    assert.equal(boot.status, 200);
    assert.match(await boot.text(), /cdxmonitor:\/\/start/);
    const help = await fetch(base + "/help");
    assert.equal(help.status, 200);
    assert.match(await help.text(), /CDXMonitor — установка/);
    const helpAlias = await fetch(base + "/help.html");
    assert.equal(helpAlias.status, 200);
    assert.match(await helpAlias.text(), /CDXMonitor — установка/);
    const bootAlias = await fetch(base + "/boot.html");
    assert.equal(bootAlias.status, 200);
    assert.match(await bootAlias.text(), /help\.html/);
    const statAlias = await fetch(base + "/Statistic.html");
    assert.equal(statAlias.status, 200);
    assert.match(await statAlias.text(), /http-equiv="refresh"/);
    const stubAlias = await fetch(base + "/stub.html");
    assert.equal(stubAlias.status, 200);
    assert.match(await stubAlias.text(), /api\/events/);
    const stub = await fetch(base + "/");
    assert.equal(stub.status, 200);
    assert.match(await stub.text(), /api\/events/);
  });

  it("streams snapshot frames over SSE", async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(base + "/api/events", { signal: ctrl.signal });
      assert.equal(res.status, 200);
      const reader = res.body?.getReader();
      assert.ok(reader);
      let acc = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        acc += Buffer.from(chunk.value).toString("utf8");
        const m = acc.match(/^data: (\{.*\})$/m);
        if (m && m[1]) {
          const frame = JSON.parse(m[1] as string) as {
            turn: { input: number };
          };
          assert.equal(frame.turn.input, 1000);
          break;
        }
      }
      reader.releaseLock();
    } finally {
      clearTimeout(timer);
    }
  });

  it("fails loudly when the port is occupied", async () => {
    assert.ok(running);
    const used = running.port;
    let err: unknown = null;
    try {
      await startServer({
        port: used,
        bind: "127.0.0.1",
        sessionsRoot: sessionsDir,
        explicitFile: null,
        webDir: path.resolve(__dirname, "..", "..", "web"),
      });
    } catch (e) {
      err = e;
    }
    assert.equal((err as { code?: string } | null)?.code, "EADDRINUSE");
  });

  it("falls back to stub when the UI bundle is absent", async () => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /api\/events/);
  });

  it("turns lists per-turn aggregates", async () => {
    const res = await fetch(base + "/api/turns?refresh=1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      updatedAt: string;
      turns: Array<{ id: string; input: number; output: number; events: number }>;
    };
    assert.ok(body.updatedAt);
    assert.equal(body.turns.length, 1);
    assert.equal(body.turns[0]?.id, "turn-1");
    assert.equal(body.turns[0]?.input, 1000);
  });

  it("activity exposes tool counters and series", async () => {
    const res = await fetch(base + "/api/activity");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      tools: Record<string, number>;
      series: Array<{ t: number; input: number }>;
    };
    assert.deepEqual(body.tools, {});
    assert.equal(body.series.length, 1);
    assert.equal(body.series[0]?.input, 1000);
  });

  it("reviews sums auxiliary rollouts on demand", async () => {
    fs.writeFileSync(
      path.join(sessionsDir, "rollout-aux.jsonl"),
      toJsonl([
        sessionMeta({ threadSource: "guardian_review", model: "codex-auto-review" }),
        usageRecord({ turnId: "r1", input: 300, cached: 100, output: 30, reasoning: 3 }),
        usageRecord({ turnId: "r1", input: 200, cached: 50, output: 20, reasoning: 2 }),
      ]),
      "utf8",
    );
    const res = await fetch(base + "/api/reviews?refresh=1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      files: Array<{ id: string; input: number; output: number; events: number }>;
      totalInput: number;
    };
    assert.equal(body.files.length, 1);
    assert.equal(body.files[0]?.id, "rollout-aux.jsonl");
    assert.equal(body.files[0]?.input, 500);
    assert.equal(body.totalInput, 500);
  });
});

describe("app static guard", () => {
  let appServer: RunningServer | null = null;
  let appBase = "";

  before(async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-app-"));
    fs.mkdirSync(path.join(web, "app", "assets"), { recursive: true });
    fs.writeFileSync(path.join(web, "app", "index.html"), "<div id=\"root\"></div>", "utf8");
    fs.writeFileSync(
      path.join(web, "app", "assets", "x.js"), "console.log(1)", "utf8");
    fs.writeFileSync(path.join(web, "secret.txt"), "private", "utf8");
    appServer = await startServer({
      port: 0,
      bind: "127.0.0.1",
      sessionsRoot: sessionsDir,
      explicitFile: null,
      webDir: web,
    });
    appBase = "http://127.0.0.1:" + String(appServer.port);
  });

  after(async () => {
    if (appServer) await appServer.stop();
  });

  it("serves the built index and assets", async () => {
    const idx = await fetch(appBase + "/");
    assert.equal(idx.status, 200);
    assert.match(await idx.text(), /id="root"/);
    const js = await fetch(appBase + "/assets/x.js");
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.match(await js.text(), /console\.log/);
  });

  it("blocks traversal and non-app files", async () => {
    for (const p of ["/secret.txt", "/../secret.txt", "/assets/../../secret.txt"]) {
      const res = await fetch(appBase + p);
      assert.equal(res.status, 404);
    }
  });
});

describe("entry point log file", () => {
  it("writes the startup line to --log-file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-main-"));
    const sessions = path.join(dir, "sessions");
    fs.mkdirSync(sessions);
    const logFile = path.join(dir, "server.log");
    const mainJs = path.resolve(__dirname, "..", "src", "main.js");
    const child = spawn(
      process.execPath,
      [
        mainJs, "--port", "0", "--sessions", sessions,
        "--web-dir", path.resolve(__dirname, "..", "..", "web"),
        "--data-dir", path.join(dir, "data"), "--log-file", logFile,
      ],
      { stdio: "ignore" },
    );
    try {
      let content = "";
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          content = fs.readFileSync(logFile, "utf8");
        } catch {
          continue;
        }
        if (content.includes("listening on http://127.0.0.1:")) break;
      }
      assert.match(content, /listening on http:\/\/127\.0\.0\.1:\d+/);
    } finally {
      child.kill();
    }
  });

  it("refuses a second instance on the same data dir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-lock-"));
    const sessions = path.join(dir, "sessions");
    fs.mkdirSync(sessions);
    const webDir = path.resolve(__dirname, "..", "..", "web");
    const dataDir = path.join(dir, "data");
    const mainJs = path.resolve(__dirname, "..", "src", "main.js");
    const run = (extra: string[]) =>
      spawn(process.execPath, [mainJs, "--port", "0", "--sessions", sessions,
        "--web-dir", webDir, "--data-dir", dataDir, ...extra], { stdio: "ignore" });
    const first = run([]);
    try {
      // Wait until the first instance holds the lock.
      const lockPath = path.join(dataDir, "server.lock");
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (fs.existsSync(lockPath)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(fs.existsSync(lockPath));
      const second = run([]);
      const code: number = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          second.kill();
          resolve(-99);
        }, 15000);
        second.on("exit", (c) => {
          clearTimeout(timer);
          resolve(c ?? -98);
        });
      });
      assert.equal(code, 1);
    } finally {
      first.kill();
    }
  });

  it("refuses a second instance on the same port from another data dir", async () => {
    const port: number = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.on("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        s.close(() => resolve(p));
      });
    });
    assert.ok(port > 0);
    const webDir = path.resolve(__dirname, "..", "..", "web");
    const mainJs = path.resolve(__dirname, "..", "src", "main.js");
    const mkSessions = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-plock-"));
      fs.mkdirSync(path.join(dir, "sessions"));
      return dir;
    };
    const dirA = mkSessions();
    const dirB = mkSessions();
    const run = (dir: string) =>
      spawn(process.execPath,
        [mainJs, "--port", String(port), "--sessions", path.join(dir, "sessions"),
          "--web-dir", webDir, "--data-dir", path.join(dir, "data")],
        { stdio: "ignore" });
    const first = run(dirA);
    try {
      const tmp = process.env["TEMP"] ?? process.env["TMP"] ?? os.tmpdir();
      const lockPath = path.join(tmp, "cdxmonitor-port-" + String(port) + ".lock");
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (fs.existsSync(lockPath)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(fs.existsSync(lockPath));
      const second = run(dirB);
      const code: number = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          second.kill();
          resolve(-99);
        }, 15000);
        second.on("exit", (c) => {
          clearTimeout(timer);
          resolve(c ?? -98);
        });
      });
      assert.equal(code, 1);
    } finally {
      first.kill();
    }
  });
});

describe("codexdb adapter", () => {
  let dbServer: RunningServer | null = null;
  let dbBase = "";

  before(async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-db-"));
    fs.mkdirSync(path.join(root, "sessions"));
    const state = new DatabaseSync(path.join(root, "state_5.sqlite"));
    state.exec(
      "CREATE TABLE projects (id TEXT, name TEXT, metadata TEXT, position INTEGER, " +
        "created_at_ms INTEGER, updated_at_ms INTEGER)",
    );
    state.exec(
      "CREATE TABLE threads (id TEXT, rollout_path TEXT, created_at TEXT, updated_at TEXT, " +
        "source TEXT, model_provider TEXT, cwd TEXT, title TEXT, sandbox_policy TEXT, " +
        "approval_mode TEXT, tokens_used INTEGER, has_user_event INTEGER, archived INTEGER, " +
        "archived_at TEXT, git_sha TEXT, git_branch TEXT, git_origin_url TEXT, cli_version TEXT, " +
        "first_user_message TEXT, agent_nickname TEXT, agent_role TEXT, memory_mode TEXT, " +
        "model TEXT, reasoning_effort TEXT, agent_path TEXT, created_at_ms INTEGER, " +
        "updated_at_ms INTEGER, thread_source TEXT, preview TEXT, recency_at TEXT, " +
        "recency_at_ms INTEGER, history_mode TEXT, name TEXT, is_pinned INTEGER, " +
        "thread_section_id TEXT, section_position INTEGER, section_entered_at_ms INTEGER, " +
        "project_id TEXT, originator TEXT, daybreak_enabled INTEGER, creator_user_id TEXT, " +
        "creator_account_id TEXT)",
    );
    state
      .prepare("INSERT INTO projects (id, name, position) VALUES (?, ?, ?)")
      .run("p1", "demo-proj", 0);
    state
      .prepare(
        "INSERT INTO threads (id, title, model, reasoning_effort, cwd, tokens_used, " +
          "thread_source, archived, project_id, updated_at_ms) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("t1", "demo thread", "gpt-6-sol", "max", "C:\\demo", 12345, "user", 0, "p1", 10);
    state.close();
    const hist = new DatabaseSync(path.join(root, "thread_history_1.sqlite"));
    hist.exec(
      "CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, status TEXT, " +
        "duration_ms INTEGER, started_at TEXT, completed_at TEXT)",
    );
    hist
      .prepare(
        "INSERT INTO thread_turns (thread_id, turn_id, status, duration_ms) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run("t1", "turn-1", "completed", 1500);
    hist.close();
    fs.writeFileSync(
      path.join(root, "models_cache.json"),
      JSON.stringify({
        models: [
          {
            slug: "gpt-6-sol",
            display_name: "GPT-6-Sol",
            context_window: 272000,
            max_context_window: 872000,
            effective_context_window_percent: 95,
          },
        ],
      }),
      "utf8",
    );
    const webDir = path.resolve(__dirname, "..", "..", "web");
    dbServer = await startServer({
      port: 0,
      bind: "127.0.0.1",
      sessionsRoot: path.join(root, "sessions"),
      explicitFile: null,
      webDir,
    });
    dbBase = "http://127.0.0.1:" + String(dbServer.port);
  });

  after(async () => {
    if (dbServer) await dbServer.stop();
  });

  it("reports present files", async () => {
    const res = await fetch(dbBase + "/api/codex/status");
    const body = (await res.json()) as { files: Record<string, boolean> };
    assert.deepEqual(body.files, { stateDb: true, historyDb: true, modelsCache: true });
  });

  it("lists projects and threads", async () => {
    const pj = (await (await fetch(dbBase + "/api/codex/projects")).json()) as Array<{
      id: string;
      name: string;
    }>;
    assert.equal(pj.length, 1);
    assert.equal(pj[0]?.name, "demo-proj");
    const th = (await (await fetch(dbBase + "/api/codex/sessions")).json()) as Array<{
      id: string;
      tokensUsed: number | null;
    }>;
    assert.equal(th.length, 1);
    assert.equal(th[0]?.id, "t1");
    assert.equal(th[0]?.tokensUsed, 12345);
  });

  it("shows turn statuses on demand", async () => {
    const res = await fetch(dbBase + "/api/codex/turns?thread=t1");
    const body = (await res.json()) as Array<{ turnId: string; durationMs: number | null }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]?.turnId, "turn-1");
    assert.equal(body[0]?.durationMs, 1500);
  });

  it("reads catalog windows", async () => {
    const res = await fetch(dbBase + "/api/codex/catalog");
    const body = (await res.json()) as Array<{ slug: string; contextWindow: number | null }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]?.slug, "gpt-6-sol");
    assert.equal(body[0]?.contextWindow, 272000);
  });
});
