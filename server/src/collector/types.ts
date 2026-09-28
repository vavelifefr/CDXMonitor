// Collector state. 1:1 port of MonitorState (codex_context_monitor.py, v0.11)
// plus CDXMonitor extensions: secondary limits, cache-write, compaction, diag.

export interface UsageNumbers {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
}

export function zeroUsage(): UsageNumbers {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}

export interface RateLimit {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export function emptyLimit(): RateLimit {
  return { usedPercent: null, windowMinutes: null, resetsAt: null };
}

export interface CompactionInfo {
  count: number;
  lastTime: string;
  lastWindow: number | null;
  lastInput: number | null;
}

export interface CollectorState {
  file: string | null;
  model: string;
  effort: string;
  timestamp: string;
  lastActivityEpoch: number;

  contextWindow: number;
  last: UsageNumbers;
  total: UsageNumbers;
  usageRecordsSeen: boolean;

  primary: RateLimit;
  secondary: RateLimit;
  limitName: string;
  limitId: string;
  planType: string;
  creditsUnlimited: boolean | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string;

  contextDelta: number;

  tasksStarted: number;
  tasksCompleted: number;
  currentTaskTurnId: string | null;
  currentTaskCompleted: boolean;

  taskSeen: boolean;
  taskBaselineReady: boolean;
  taskSnapshot: UsageNumbers;
  taskBaseline: UsageNumbers;
  task: UsageNumbers;

  tokenEvents: number;
  compaction: CompactionInfo;
  unknownRecords: number;
}

export function initialState(): CollectorState {
  return {
    file: null,
    model: "Codex",
    effort: "",
    timestamp: "",
    lastActivityEpoch: 0,
    contextWindow: 0,
    last: zeroUsage(),
    total: zeroUsage(),
    usageRecordsSeen: false,
    primary: emptyLimit(),
    secondary: emptyLimit(),
    limitName: "",
    limitId: "",
    planType: "",
    creditsUnlimited: null,
    spendControlReached: null,
    rateLimitReachedType: "",
    contextDelta: 0,
    tasksStarted: 0,
    tasksCompleted: 0,
    currentTaskTurnId: null,
    currentTaskCompleted: false,
    taskSeen: false,
    taskBaselineReady: false,
    taskSnapshot: zeroUsage(),
    taskBaseline: zeroUsage(),
    task: zeroUsage(),
    tokenEvents: 0,
    compaction: { count: 0, lastTime: "", lastWindow: null, lastInput: null },
    unknownRecords: 0,
  };
}

// Minimal structural type for a parsed JSONL record. Only whitelisted
// numeric/structural fields are read; message text and secrets are never touched.
export type JsonRecord = Record<string, unknown>;

export function asDict(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
