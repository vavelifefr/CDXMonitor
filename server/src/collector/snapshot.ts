// Snapshot builder: normalized JSON view over CollectorState.
// `raw` mirrors the reference MonitorState field names 1:1 for A1 verification.

import { CollectorState } from "./types";

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part * 100) / whole));
}

export interface LimitSlot {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
  source: string;
}

// Window-based slot resolution. Plans differ in which limit objects Codex
// emits (e.g. Pro may carry only a weekly window in `primary`), so slots are
// assigned by window_minutes, never by primary/secondary position:
//   240..360 min -> fiveHour; >= 10000 min -> weekly; anything else -> other.
// Unknown windows are shown generically, never mislabeled.
export function resolveLimitSlots(
  primary: LimitSlot,
  secondary: LimitSlot,
): { fiveHour: LimitSlot | null; weekly: LimitSlot | null; other: LimitSlot[] } {
  const withSource = (slot: LimitSlot, source: string): LimitSlot => ({
    usedPercent: slot.usedPercent,
    windowMinutes: slot.windowMinutes,
    resetsAt: slot.resetsAt,
    source,
  });
  const prim = withSource(primary, "primary");
  const sec = withSource(secondary, "secondary");
  let fiveHour: LimitSlot | null = null;
  let weekly: LimitSlot | null = null;
  const other: LimitSlot[] = [];
  for (const slot of [prim, sec]) {
    if (slot.usedPercent === null) continue;
    const w = slot.windowMinutes;
    if (w !== null && w >= 240 && w <= 360 && fiveHour === null) {
      fiveHour = slot;
    } else if (w !== null && w >= 10000 && weekly === null) {
      weekly = slot;
    } else {
      other.push(slot);
    }
  }
  return { fiveHour, weekly, other };
}

export interface Snapshot {
  file: string | null;
  model: string;
  effort: string;
  context: {
    window: number;
    used: number;
    fillPct: number;
    remaining: number;
    fresh: number;
    cacheRatioPct: number;
    deltaPerEvent: number;
  };
  turn: Record<string, number>;
  task: Record<string, number>;
  rollout: Record<string, number>;
  tasks: { started: number; completed: number; running: number };
  limits: {
    primary: Record<string, number | null>;
    secondary: Record<string, number | null>;
    slots: {
      fiveHour: LimitSlot | null;
      weekly: LimitSlot | null;
      other: LimitSlot[];
    };
    limitName: string;
    limitId: string;
    planType: string;
    creditsUnlimited: boolean | null;
    spendControlReached: boolean | null;
    rateLimitReachedType: string;
  };
  compaction: {
    count: number;
    lastTime: string;
    lastWindow: number | null;
    lastInput: number | null;
  };
  activity: { tokenEvents: number; timestamp: string; lastActivityEpoch: number };
  diag: { unknownRecords: number; usageRecordsSeen: boolean };
  raw: Record<string, number | string | null>;
}

export function buildSnapshot(state: CollectorState): Snapshot {
  const fresh = Math.max(0, state.last.input - state.last.cached);
  return {
    file: state.file,
    model: state.model,
    effort: state.effort,
    context: {
      window: state.contextWindow,
      used: state.last.input,
      fillPct: pct(state.last.input, state.contextWindow),
      remaining: Math.max(0, state.contextWindow - state.last.input),
      fresh,
      cacheRatioPct: pct(state.last.cached, state.last.input),
      deltaPerEvent: state.contextDelta,
    },
    turn: { ...state.last },
    task: { ...state.task },
    rollout: { ...state.total },
    tasks: {
      started: state.tasksStarted,
      completed: state.tasksCompleted,
      running: Math.max(0, state.tasksStarted - state.tasksCompleted),
    },
    limits: {
      primary: { ...state.primary },
      secondary: { ...state.secondary },
      slots: resolveLimitSlots(
        { ...state.primary, source: "primary" },
        { ...state.secondary, source: "secondary" },
      ),
      limitName: state.limitName,
      limitId: state.limitId,
      planType: state.planType,
      creditsUnlimited: state.creditsUnlimited,
      spendControlReached: state.spendControlReached,
      rateLimitReachedType: state.rateLimitReachedType,
    },
    compaction: { ...state.compaction },
    activity: {
      tokenEvents: state.tokenEvents,
      timestamp: state.timestamp,
      lastActivityEpoch: state.lastActivityEpoch,
    },
    diag: {
      unknownRecords: state.unknownRecords,
      usageRecordsSeen: state.usageRecordsSeen,
    },
    raw: {
      context_window: state.contextWindow,
      last_input: state.last.input,
      last_cached: state.last.cached,
      last_output: state.last.output,
      last_reasoning: state.last.reasoning,
      last_total: state.last.total,
      total_input: state.total.input,
      total_cached: state.total.cached,
      total_output: state.total.output,
      total_reasoning: state.total.reasoning,
      total_tokens: state.total.total,
      task_input: state.task.input,
      task_cached: state.task.cached,
      task_output: state.task.output,
      task_reasoning: state.task.reasoning,
      tasks_started: state.tasksStarted,
      tasks_completed: state.tasksCompleted,
      context_delta: state.contextDelta,
      token_events: state.tokenEvents,
      limit_used_percent: state.primary.usedPercent,
      limit_window_minutes: state.primary.windowMinutes,
      limit_resets_at: state.primary.resetsAt,
      timestamp: state.timestamp,
    },
  };
}
