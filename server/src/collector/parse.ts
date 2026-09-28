// Event parser: 1:1 port of update_state_from_obj and helpers
// (codex_context_monitor.py, lines 110-624), plus CDXMonitor extensions:
// secondary rate limits, cache_write_input_tokens, top-level `compacted`
// records, unknown-record diagnostics.

import {
  asDict,
  asString,
  CollectorState,
  JsonRecord,
  UsageNumbers,
} from "./types";

export function safeInt(value: unknown, def = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return def;
}

export function safeFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseTimestampEpoch(value: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

const KNOWN_TOP_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "world_state",
  "turn_context",
  "token_usage_record",
  "compacted",
  "realtime_item",
  "inter_agent_communication_metadata",
]);

const KNOWN_EVENT_TYPES = new Set([
  "token_count",
  "task_started",
  "task_complete",
  "turn_aborted",
  "thread_settings_applied",
  "user_message",
  "agent_message",
  "message",
  "reasoning",
  "agent_reasoning",
  "compaction",
  "item_completed",
  "custom_tool_call",
  "custom_tool_call_output",
  "function_call",
  "function_call_output",
  "transcript_segment",
  "realtime_session_started",
  "realtime_session_closed",
]);

export function updateAuthoritativeModel(state: CollectorState, obj: JsonRecord): void {
  const objType = asString(obj["type"]);
  const payload = asDict(obj["payload"]);
  if (!payload) return;

  let model: string | null = null;
  let effort: string | null = null;

  if (objType === "session_meta" || objType === "turn_context") {
    if (typeof payload["model"] === "string") model = payload["model"] as string;
    const eff = payload["reasoning_effort"] ?? payload["effort"];
    if (typeof eff === "string") effort = eff;
    const collab = asDict(payload["collaboration_mode"]);
    const settings = collab ? asDict(collab["settings"]) : null;
    if (settings) {
      if (typeof settings["model"] === "string") model = settings["model"] as string;
      if (typeof settings["reasoning_effort"] === "string") {
        effort = settings["reasoning_effort"] as string;
      }
    }
  } else if (objType === "world_state") {
    const world = asDict(payload["state"]);
    if (world) {
      if (typeof world["model"] === "string") model = world["model"] as string;
      const collab = asDict(world["collaboration_mode"]);
      if (collab && typeof collab["model"] === "string") {
        model = collab["model"] as string;
      }
    }
  } else if (objType === "event_msg" && payload["type"] === "thread_settings_applied") {
    const settings = asDict(payload["thread_settings"]);
    if (settings) {
      if (typeof settings["model"] === "string") model = settings["model"] as string;
      if (typeof settings["reasoning_effort"] === "string") {
        effort = settings["reasoning_effort"] as string;
      }
      const collab = asDict(settings["collaboration_mode"]);
      const nested = collab ? asDict(collab["settings"]) : null;
      if (nested) {
        if (typeof nested["model"] === "string") model = nested["model"] as string;
        if (typeof nested["reasoning_effort"] === "string") {
          effort = nested["reasoning_effort"] as string;
        }
      }
    }
  }

  if (model && model !== "codex-auto-review" && model.length <= 100) {
    state.model = model;
  }
  if (effort && effort.length <= 30) {
    state.effort = effort;
  }
}

function beginTaskTracking(state: CollectorState, turnId: string): void {
  state.currentTaskTurnId = turnId;
  state.currentTaskCompleted = false;
  state.taskSeen = true;
  state.taskBaselineReady = false;
  state.taskSnapshot = { ...state.total };
  state.taskBaseline = { ...state.total };
  state.task = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}

export function updateTurnCounters(state: CollectorState, obj: JsonRecord): void {
  if (asString(obj["type"]) !== "event_msg") return;
  const payload = asDict(obj["payload"]);
  if (!payload) return;
  const ptype = asString(payload["type"]);
  const turnId = asString(payload["turn_id"]);

  if (ptype === "task_started") {
    if (!turnId) return;
    if (turnId === state.currentTaskTurnId) return;
    if (state.currentTaskTurnId !== null && !state.currentTaskCompleted) {
      state.tasksCompleted += 1;
    }
    state.tasksStarted += 1;
    beginTaskTracking(state, turnId);
    return;
  }

  if (ptype === "task_complete" || ptype === "turn_aborted") {
    if (turnId && turnId === state.currentTaskTurnId && !state.currentTaskCompleted) {
      state.currentTaskCompleted = true;
      state.tasksCompleted += 1;
    }
  }
}

function firstTaskBaseline(
  total: number,
  last: number,
  snapshot: number,
  lastPresent: boolean,
): number {
  if (total <= snapshot) return snapshot;
  if (lastPresent && total >= last) {
    const candidate = total - last;
    if (candidate >= snapshot) return candidate;
  }
  return snapshot;
}

function updateTaskUsage(
  state: CollectorState,
  last: Record<string, unknown>,
): void {
  if (!state.taskSeen) return;
  if (!state.taskBaselineReady) {
    state.taskBaseline.input = firstTaskBaseline(
      state.total.input, state.last.input, state.taskSnapshot.input, "input_tokens" in last);
    state.taskBaseline.cached = firstTaskBaseline(
      state.total.cached, state.last.cached, state.taskSnapshot.cached, "cached_input_tokens" in last);
    state.taskBaseline.cacheWrite = firstTaskBaseline(
      state.total.cacheWrite, state.last.cacheWrite,
      state.taskSnapshot.cacheWrite, "cache_write_input_tokens" in last);
    state.taskBaseline.output = firstTaskBaseline(
      state.total.output, state.last.output, state.taskSnapshot.output, "output_tokens" in last);
    state.taskBaseline.reasoning = firstTaskBaseline(
      state.total.reasoning, state.last.reasoning,
      state.taskSnapshot.reasoning, "reasoning_output_tokens" in last);
    state.taskBaselineReady = true;
  }
  state.task.input = Math.max(0, state.total.input - state.taskBaseline.input);
  state.task.cached = Math.max(0, state.total.cached - state.taskBaseline.cached);
  state.task.cacheWrite = Math.max(0, state.total.cacheWrite - state.taskBaseline.cacheWrite);
  state.task.output = Math.max(0, state.total.output - state.taskBaseline.output);
  state.task.reasoning = Math.max(0, state.total.reasoning - state.taskBaseline.reasoning);
  state.task.total = state.task.input + state.task.output;
}

function readUsageNumbers(usage: Record<string, unknown>, totalDefault: number | null): UsageNumbers {
  const input = safeInt(usage["input_tokens"]);
  const output = safeInt(usage["output_tokens"]);
  return {
    input,
    cached: safeInt(usage["cached_input_tokens"]),
    cacheWrite: safeInt(usage["cache_write_input_tokens"]),
    output,
    reasoning: safeInt(usage["reasoning_output_tokens"]),
    total: safeInt(usage["total_tokens"], totalDefault ?? input + output),
  };
}

function applyRateLimits(
  state: CollectorState,
  rateLimits: Record<string, unknown>,
): void {
  const primary = asDict(rateLimits["primary"]);
  if (primary) {
    const used = safeFloat(primary["used_percent"]);
    if (used !== null) state.primary.usedPercent = used;
    if (primary["window_minutes"] !== undefined && primary["window_minutes"] !== null) {
      state.primary.windowMinutes = safeInt(primary["window_minutes"]);
    }
    if (primary["resets_at"] !== undefined && primary["resets_at"] !== null) {
      state.primary.resetsAt = safeInt(primary["resets_at"]);
    }
  }
  const secondary = asDict(rateLimits["secondary"]);
  if (secondary) {
    const used = safeFloat(secondary["used_percent"]);
    if (used !== null) state.secondary.usedPercent = used;
    if (secondary["window_minutes"] !== undefined && secondary["window_minutes"] !== null) {
      state.secondary.windowMinutes = safeInt(secondary["window_minutes"]);
    }
    if (secondary["resets_at"] !== undefined && secondary["resets_at"] !== null) {
      state.secondary.resetsAt = safeInt(secondary["resets_at"]);
    }
  }
  if (typeof rateLimits["limit_name"] === "string") {
    state.limitName = rateLimits["limit_name"] as string;
  }
  if (typeof rateLimits["limit_id"] === "string") {
    state.limitId = rateLimits["limit_id"] as string;
  }
  const credits = asDict(rateLimits["credits"]);
  if (credits && typeof credits["unlimited"] === "boolean") {
    state.creditsUnlimited = credits["unlimited"] as boolean;
  }
  if (typeof rateLimits["spend_control_reached"] === "boolean") {
    state.spendControlReached = rateLimits["spend_control_reached"] as boolean;
  }
  if (typeof rateLimits["rate_limit_reached_type"] === "string") {
    state.rateLimitReachedType = rateLimits["rate_limit_reached_type"] as string;
  }
  const plan =
    rateLimits["plan_type"] ??
    (credits ? credits["plan_type"] : undefined);
  if (typeof plan === "string" && plan) {
    state.planType = plan;
  }
}

function updateFromCompacted(state: CollectorState, obj: JsonRecord): void {
  const payload = asDict(obj["payload"]);
  if (!payload) {
    state.unknownRecords += 1;
    return;
  }
  state.compaction.count += 1;
  state.compaction.lastTime = asString(obj["timestamp"]);
  const windowNumber = payload["window_number"];
  if (typeof windowNumber === "number" && Number.isFinite(windowNumber)) {
    state.compaction.lastWindow = Math.trunc(windowNumber);
  }
  const rec = asDict(payload["latest_token_usage_record"]);
  const usage = rec ? asDict(rec["usage"]) : null;
  if (usage) {
    state.compaction.lastInput = safeInt(usage["input_tokens"]);
  }
}

export function updateStateFromObj(state: CollectorState, obj: JsonRecord): void {
  updateAuthoritativeModel(state, obj);
  updateTurnCounters(state, obj);

  const objType = asString(obj["type"]);

  if (objType === "compacted") {
    updateFromCompacted(state, obj);
    return;
  }

  if (objType === "token_usage_record") {
    const payload = asDict(obj["payload"]);
    const usage = payload ? asDict(payload["usage"]) : null;
    if (!usage) {
      state.unknownRecords += 1;
      return;
    }
    const prevContext = state.last.input;
    state.usageRecordsSeen = true;
    const u = readUsageNumbers(usage, null);
    state.last = u;
    state.total.input += u.input;
    state.total.cached += u.cached;
    state.total.cacheWrite += u.cacheWrite;
    state.total.output += u.output;
    state.total.reasoning += u.reasoning;
    state.total.total = state.total.input + state.total.output;
    updateTaskUsage(state, usage);
    if (prevContext) {
      state.contextDelta = state.last.input - prevContext;
    }
    state.timestamp = asString(obj["timestamp"]);
    state.lastActivityEpoch = parseTimestampEpoch(state.timestamp);
    return;
  }

  if (objType !== "event_msg") {
    if (!KNOWN_TOP_TYPES.has(objType)) state.unknownRecords += 1;
    return;
  }

  const payload = asDict(obj["payload"]);
  if (!payload) {
    state.unknownRecords += 1;
    return;
  }
  if (asString(payload["type"]) !== "token_count") {
    if (!KNOWN_EVENT_TYPES.has(asString(payload["type"]))) state.unknownRecords += 1;
    return;
  }

  const info = asDict(payload["info"]) ?? {};
  const total = asDict(info["total_token_usage"]) ?? {};
  const last = asDict(info["last_token_usage"]) ?? {};

  const window = safeInt(info["model_context_window"]);
  if (window > 0) state.contextWindow = window;

  const incoming = readUsageNumbers(last, 0);

  if (state.usageRecordsSeen) {
    const t = readUsageNumbers(total, 0);
    state.total.input = Math.max(state.total.input, t.input);
    state.total.cached = Math.max(state.total.cached, t.cached);
    state.total.cacheWrite = Math.max(state.total.cacheWrite, t.cacheWrite);
    state.total.output = Math.max(state.total.output, t.output);
    state.total.reasoning = Math.max(state.total.reasoning, t.reasoning);
    state.total.total = Math.max(
      state.total.total, t.total, state.total.input + state.total.output);

    const current = state.last;
    // Byte-exact with the reference: the TURN-override decision compares the
    // same 5 fields the Python monitor tracks (cache_write rides along).
    const same =
      incoming.input === current.input &&
      incoming.cached === current.cached &&
      incoming.output === current.output &&
      incoming.reasoning === current.reasoning &&
      incoming.total === current.total;
    const anyUsage =
      incoming.input !== 0 || incoming.cached !== 0 ||
      incoming.output !== 0 || incoming.reasoning !== 0 || incoming.total !== 0;
    if (anyUsage && !same) {
      const prevContext = state.last.input;
      state.last = incoming;
      if (prevContext) {
        state.contextDelta = state.last.input - prevContext;
      }
    }
  } else {
    const prevContext = state.last.input;
    state.last = incoming;
    const t = readUsageNumbers(total, 0);
    state.total = t;
    if (prevContext) {
      state.contextDelta = state.last.input - prevContext;
    }
  }

  updateTaskUsage(state, last);

  const rateLimits = asDict(payload["rate_limits"]);
  if (rateLimits) applyRateLimits(state, rateLimits);

  state.timestamp = asString(obj["timestamp"]);
  state.lastActivityEpoch = parseTimestampEpoch(state.timestamp);
  state.tokenEvents += 1;
}

export function parseJsonLine(state: CollectorState, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    state.unknownRecords += 1;
    return;
  }
  const dict = asDict(obj);
  if (dict) updateStateFromObj(state, dict);
  else state.unknownRecords += 1;
}

// Byte-needle prefilter: port of line_might_matter, extended with "compacted".
const NEEDLES = [
  '"token_usage_record"',
  '"token_count"',
  '"compacted"',
  '"user_message"',
  '"task_started"',
  '"task_complete"',
  '"turn_aborted"',
  '"session_meta"',
  '"turn_context"',
  '"world_state"',
  '"thread_settings_applied"',
];

export function lineMightMatter(raw: string): boolean {
  for (const needle of NEEDLES) {
    if (raw.includes(needle)) return true;
  }
  return false;
}
