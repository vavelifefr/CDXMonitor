// Synthetic fixtures only. No real session data.
// Mirrors tests/test_monitor.py builders from the reference project.

export function tokenRecord(opts: {
  timestamp?: string;
  lastInput?: number;
  lastCached?: number;
  totalInput?: number;
  totalCached?: number;
  lastOutput?: number;
  lastReasoning?: number;
  totalOutput?: number;
  totalReasoning?: number;
  usedPercent?: number | null;
  windowMinutes?: number;
  planType?: string | null;
} = {}): Record<string, unknown> {
  const {
    timestamp = "2026-08-14T18:43:51Z",
    lastInput = 207792,
    lastCached = 206592,
    totalInput = 33043009,
    totalCached = 32295424,
    lastOutput = 1897,
    lastReasoning = 914,
    totalOutput = 83753,
    totalReasoning = 23616,
    usedPercent = 11.0,
    windowMinutes = 10080,
    planType = "plus",
  } = opts;
  const ratePrimary: Record<string, unknown> = { window_minutes: windowMinutes };
  if (usedPercent !== null) ratePrimary["used_percent"] = usedPercent;
  const rateLimits: Record<string, unknown> = { primary: ratePrimary };
  if (planType !== null) rateLimits["plan_type"] = planType;
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: totalInput,
          cached_input_tokens: totalCached,
          output_tokens: totalOutput,
          reasoning_output_tokens: totalReasoning,
          total_tokens: totalInput + totalOutput,
        },
        last_token_usage: {
          input_tokens: lastInput,
          cached_input_tokens: lastCached,
          output_tokens: lastOutput,
          reasoning_output_tokens: lastReasoning,
          total_tokens: lastInput + lastOutput,
        },
        model_context_window: 258400,
      },
      rate_limits: rateLimits,
    },
  };
}

export function usageRecord(opts: {
  timestamp?: string;
  turnId?: string;
  input?: number;
  cached?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
} = {}): Record<string, unknown> {
  const {
    timestamp = "2026-09-22T18:43:50Z",
    turnId = "turn-1",
    input = 1000,
    cached = 800,
    cacheWrite = 50,
    output = 100,
    reasoning = 20,
  } = opts;
  return {
    timestamp,
    type: "token_usage_record",
    payload: {
      turn_id: turnId,
      usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        cache_write_input_tokens: cacheWrite,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: input + output,
      },
    },
  };
}

export function taskEvent(eventType = "task_started", turnId = "turn-1"): Record<string, unknown> {
  return { type: "event_msg", payload: { type: eventType, turn_id: turnId } };
}

export function sessionMeta(opts: {
  threadSource?: string;
  model?: string | null;
  source?: string;
} = {}): Record<string, unknown> {
  const { threadSource = "user", model = "gpt-5.6-luna", source = "vscode" } = opts;
  const payload: Record<string, unknown> = {
    thread_source: threadSource,
    source,
    reasoning_effort: "high",
  };
  if (model !== null) payload["model"] = model;
  return { timestamp: "2026-08-14T18:40:00Z", type: "session_meta", payload };
}

export function compactedRecord(opts: {
  timestamp?: string;
  windowNumber?: number;
  input?: number;
} = {}): Record<string, unknown> {
  const { timestamp = "2026-09-22T14:26:23.751Z", windowNumber = 1, input = 50000 } = opts;
  return {
    timestamp,
    type: "compacted",
    ordinal: 42,
    payload: {
      message: "",
      window_number: windowNumber,
      window_id: "w-new",
      previous_window_id: "w-old",
      first_window_id: "w-first",
      latest_token_usage_record: {
        usage: {
          input_tokens: input,
          cached_input_tokens: input - 1000,
          output_tokens: 10,
          reasoning_output_tokens: 5,
          total_tokens: input + 10,
        },
      },
    },
  };
}

export function toJsonl(records: Array<Record<string, unknown>>): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
