// E1 collector tests. Synthetic records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initialState } from "../src/collector/types";
import {
  lineMightMatter,
  parseJsonLine,
  updateStateFromObj,
} from "../src/collector/parse";
import { classifyRollout, newestRollout } from "../src/collector/classify";
import { newCursor, readNew, scanFullFile } from "../src/collector/tail";
import {
  compactedRecord,
  sessionMeta,
  taskEvent,
  toJsonl,
  tokenRecord,
  usageRecord,
} from "./fixtures";

function feed(records: Array<Record<string, unknown>>) {
  const state = initialState();
  for (const r of records) updateStateFromObj(state, r);
  return state;
}

describe("token accounting", () => {
  it("uses token_usage_record as primary source", () => {
    const s = feed([usageRecord({ input: 1000, cached: 800, output: 100, reasoning: 20 })]);
    assert.equal(s.usageRecordsSeen, true);
    assert.equal(s.last.input, 1000);
    assert.equal(s.last.cached, 800);
    assert.equal(s.last.cacheWrite, 50);
    assert.equal(s.total.input, 1000);
    assert.equal(s.total.total, 1100);
    assert.equal(s.tokenEvents, 0);
  });

  it("falls back to legacy token_count without usage records", () => {
    const s = feed([tokenRecord()]);
    assert.equal(s.usageRecordsSeen, false);
    assert.equal(s.last.input, 207792);
    assert.equal(s.contextWindow, 258400);
    assert.equal(s.total.input, 33043009);
    assert.equal(s.total.total, 33043009 + 83753);
    assert.equal(s.tokenEvents, 1);
    assert.equal(s.primary.usedPercent, 11.0);
  });

  it("does not double-count mirrored token_count after usage records", () => {
    const s = feed([
      usageRecord({ input: 1000, cached: 800, output: 100, reasoning: 20 }),
      tokenRecord({
        lastInput: 1000,
        lastCached: 800,
        totalInput: 1000,
        totalCached: 800,
        lastOutput: 100,
        lastReasoning: 20,
        totalOutput: 100,
        totalReasoning: 20,
      }),
    ]);
    assert.equal(s.total.input, 1000);
    assert.equal(s.total.output, 100);
  });

  it("reconciles upward when token_count exceeds usage sums", () => {
    const s = feed([
      usageRecord({ input: 1000, cached: 800, output: 100, reasoning: 20 }),
      tokenRecord({
        lastInput: 1000,
        lastCached: 800,
        totalInput: 5000,
        totalCached: 4000,
        lastOutput: 100,
        lastReasoning: 20,
        totalOutput: 300,
        totalReasoning: 60,
      }),
    ]);
    assert.equal(s.total.input, 5000);
    assert.equal(s.total.output, 300);
  });
});

describe("task boundaries", () => {
  it("starts a task only on a new turn_id", () => {
    const s = feed([
      taskEvent("task_started", "t1"),
      usageRecord({ turnId: "t1", input: 1000, cached: 800, output: 100, reasoning: 20 }),
      taskEvent("task_started", "t1"),
      usageRecord({ turnId: "t1", input: 2000, cached: 1500, output: 200, reasoning: 40 }),
    ]);
    assert.equal(s.tasksStarted, 1);
    assert.equal(s.task.input, 3000);
  });

  it("closes the prior task when a new turn_id arrives", () => {
    const s = feed([taskEvent("task_started", "t1"), taskEvent("task_started", "t2")]);
    assert.equal(s.tasksStarted, 2);
    assert.equal(s.tasksCompleted, 1);
  });

  it("closes on matching task_complete and turn_aborted", () => {
    const s = feed([
      taskEvent("task_started", "t1"),
      taskEvent("task_complete", "t1"),
      taskEvent("task_started", "t2"),
      taskEvent("turn_aborted", "t2"),
    ]);
    assert.equal(s.tasksCompleted, 2);
  });

  it("reconstructs the task baseline on full replay (restart-safe)", () => {
    const s = feed([
      taskEvent("task_started", "t9"),
      usageRecord({ turnId: "t9", input: 4000, cached: 3900, output: 50, reasoning: 10 }),
      usageRecord({ turnId: "t9", input: 4100, cached: 3950, output: 70, reasoning: 15 }),
    ]);
    assert.equal(s.task.input, 8100);
    assert.equal(s.task.output, 120);
  });
});

describe("model authority", () => {
  it("ignores codex-auto-review as model", () => {
    const s = feed([
      sessionMeta({ model: "gpt-6-luna" }),
      { type: "session_meta", payload: { model: "codex-auto-review" } },
    ]);
    assert.equal(s.model, "gpt-6-luna");
  });

  it("takes effort from turn_context", () => {
    const s = feed([
      { type: "turn_context", payload: { model: "gpt-6-sol", effort: "max" } },
    ]);
    assert.equal(s.model, "gpt-6-sol");
    assert.equal(s.effort, "max");
  });
});

describe("limits", () => {
  it("parses secondary weekly limits and extras", () => {
    const rec = tokenRecord() as {
      payload: {
        rate_limits: {
          secondary: Record<string, unknown>;
          plan_type?: unknown;
        } & Record<string, unknown>;
      };
    };
    rec.payload.rate_limits["secondary"] = {
      used_percent: 14.35,
      window_minutes: 10080,
      resets_at: 1787234803,
    };
    rec.payload.rate_limits["limit_name"] = "weekly";
    rec.payload.rate_limits["spend_control_reached"] = false;
    const s = feed([rec]);
    assert.equal(s.secondary.usedPercent, 14.35);
    assert.equal(s.secondary.windowMinutes, 10080);
    assert.equal(s.limitName, "weekly");
    assert.equal(s.spendControlReached, false);
    assert.equal(s.planType, "plus");
  });

  it("keeps plan type empty when absent", () => {
    const s = feed([tokenRecord({ planType: null })]);
    assert.equal(s.planType, "");
  });
});

describe("compaction", () => {
  it("counts compacted records with time and usage", () => {
    const s = feed([compactedRecord({ windowNumber: 2, input: 60000 })]);
    assert.equal(s.compaction.count, 1);
    assert.equal(s.compaction.lastWindow, 2);
    assert.equal(s.compaction.lastInput, 60000);
    assert.equal(s.compaction.lastTime, "2026-09-22T14:26:23.751Z");
  });

  it("needle prefilter covers compacted", () => {
    assert.equal(lineMightMatter('{"type":"compacted"}'), true);
    assert.equal(lineMightMatter('{"type":"message"}'), false);
  });
});

describe("diagnostics", () => {
  it("counts unknown and malformed records without throwing", () => {
    const s = initialState();
    parseJsonLine(s, '{"type":"something_new","payload":{}}');
    parseJsonLine(s, "not json {{{");
    parseJsonLine(s, "");
    assert.equal(s.unknownRecords, 2);
  });
});

describe("classifier", () => {
  function tmpFile(name: string, content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-"));
    const p = path.join(dir, name);
    fs.writeFileSync(p, content, "utf8");
    return p;
  }

  it("classifies user threads as primary", () => {
    const p = tmpFile("rollout-a.jsonl", toJsonl([sessionMeta({ threadSource: "user" })]));
    assert.equal(classifyRollout(p), "primary");
  });

  it("skips guardian review children", () => {
    const p = tmpFile(
      "rollout-b.jsonl",
      toJsonl([
        sessionMeta({ threadSource: "guardian_review", model: "codex-auto-review" }),
      ]),
    );
    assert.equal(classifyRollout(p), "auxiliary");
  });

  it("returns unknown for empty files and falls back in selection", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-sel-"));
    const aux = path.join(dir, "rollout-aux.jsonl");
    fs.writeFileSync(
      aux,
      toJsonl([sessionMeta({ threadSource: "guardian_review", model: "codex-auto-review" })]),
      "utf8",
    );
    assert.equal(classifyRollout(path.join(dir, "rollout-empty.jsonl")), "unknown");
    assert.equal(newestRollout(dir, null), null);
    const primary = path.join(dir, "rollout-main.jsonl");
    fs.writeFileSync(primary, toJsonl([sessionMeta({ threadSource: "user" })]), "utf8");
    assert.equal(newestRollout(dir, null), primary);
  });
});

describe("tail reader", () => {
  it("replays fully then reads incrementally without double counting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-tail-"));
    const p = path.join(dir, "rollout-t.jsonl");
    fs.writeFileSync(
      p,
      toJsonl([usageRecord({ input: 1000, cached: 800, output: 100, reasoning: 20 })]),
      "utf8",
    );
    const state = initialState();
    const cursor = newCursor();
    scanFullFile(p, state, cursor);
    assert.equal(state.total.input, 1000);
    fs.appendFileSync(
      p,
      toJsonl([usageRecord({ input: 2000, cached: 1500, output: 200, reasoning: 40 })]),
      "utf8",
    );
    readNew(p, state, cursor);
    assert.equal(state.total.input, 3000);
    readNew(p, state, cursor);
    assert.equal(state.total.input, 3000);
  });

  it("keeps an unterminated EOF fragment until completed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdx-part-"));
    const p = path.join(dir, "rollout-p.jsonl");
    const full = JSON.stringify(usageRecord({ input: 700, cached: 600, output: 70, reasoning: 7 }));
    fs.writeFileSync(p, full.slice(0, 40), "utf8");
    const state = initialState();
    const cursor = newCursor();
    scanFullFile(p, state, cursor);
    assert.equal(state.total.input, 0);
    fs.appendFileSync(p, full.slice(40) + "\n", "utf8");
    readNew(p, state, cursor);
    assert.equal(state.total.input, 700);
  });
});

describe("per-turn aggregates", () => {
  it("groups usage by turn_id", () => {
    const s = feed([
      usageRecord({ turnId: "a", input: 1000, cached: 800, output: 100, reasoning: 20 }),
      usageRecord({ turnId: "a", input: 2000, cached: 1500, output: 200, reasoning: 40 }),
      usageRecord({ turnId: "b", input: 500, cached: 100, output: 50, reasoning: 5 }),
    ]);
    assert.equal(s.turnStats.size, 2);
    const a = s.turnStats.get("a");
    assert.ok(a);
    assert.equal(a.input, 3000);
    assert.equal(a.events, 2);
    assert.equal(s.turnStats.get("b")?.output, 50);
  });

  it("maps turn_id to model from turn_context", () => {
    const s = feed([
      { type: "turn_context", payload: { turn_id: "a", model: "gpt-6-sol" } },
      usageRecord({ turnId: "a", input: 100, cached: 10, output: 10, reasoning: 1 }),
    ]);
    assert.equal(s.turnModels.get("a"), "gpt-6-sol");
    assert.equal(s.model, "gpt-6-sol");
  });
});

describe("tool activity and series", () => {
  it("counts response_item payload types", () => {
    const s = feed([
      { type: "response_item", payload: { type: "function_call" } },
      { type: "response_item", payload: { type: "function_call" } },
      { type: "response_item", payload: { type: "custom_tool_call_output" } },
      { type: "response_item", payload: {} },
    ]);
    assert.equal(s.toolCalls["function_call"], 2);
    assert.equal(s.toolCalls["custom_tool_call_output"], 1);
    assert.equal(s.unknownRecords, 1);
  });

  it("records a series point per usage event", () => {
    const s = feed([
      usageRecord({ timestamp: "2026-09-22T18:43:50Z", input: 1000 }),
      usageRecord({ timestamp: "2026-09-22T18:44:50Z", input: 2000 }),
    ]);
    assert.equal(s.series.length, 2);
    assert.ok(s.series[1]!.t > s.series[0]!.t);
    assert.equal(s.series[1]!.input, 2000);
  });
});
