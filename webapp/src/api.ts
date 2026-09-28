// Snapshot types mirror server/src/collector/snapshot.ts JSON (subset used by E3 UI).

export interface UsageMap {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
}

export interface LimitInfo {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
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
  turn: UsageMap;
  task: UsageMap;
  rollout: UsageMap;
  tasks: { started: number; completed: number; running: number };
  limits: {
    primary: LimitInfo;
    secondary: LimitInfo;
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
}

export function fetchSnapshot(): Promise<Snapshot> {
  return fetch("api/snapshot", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("snapshot http " + String(r.status));
    return r.json() as Promise<Snapshot>;
  });
}

export function subscribeSnapshots(onFrame: (s: Snapshot) => void): () => void {
  const es = new EventSource("api/events");
  es.onmessage = (ev: MessageEvent) => {
    try {
      onFrame(JSON.parse(ev.data) as Snapshot);
    } catch {
      // ignore malformed frames; next tick recovers
    }
  };
  return () => es.close();
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

export interface TurnsResponse {
  updatedAt: string;
  turns: TurnView[];
}

export function fetchTurns(refresh: boolean): Promise<TurnsResponse> {
  return fetch("api/turns" + (refresh ? "?refresh=1" : ""), { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("turns http " + String(r.status));
    return r.json() as Promise<TurnsResponse>;
  });
}

export interface ActivityResponse {
  tools: Record<string, number>;
  series: Array<{ t: number; input: number }>;
  compaction: number;
}

export function fetchActivity(): Promise<ActivityResponse> {
  return fetch("api/activity", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("activity http " + String(r.status));
    return r.json() as Promise<ActivityResponse>;
  });
}

export interface ReviewsResponse {
  updatedAt: string;
  files: Array<{ id: string; input: number; output: number; events: number }>;
  totalInput: number;
  totalOutput: number;
}

export function fetchReviews(refresh: boolean): Promise<ReviewsResponse> {
  return fetch("api/reviews" + (refresh ? "?refresh=1" : ""), { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("reviews http " + String(r.status));
    return r.json() as Promise<ReviewsResponse>;
  });
}

export interface RolloutSession {
  id: string;
  kind: string;
  mtimeMs: number;
  size: number;
}

export function fetchRollouts(): Promise<RolloutSession[]> {
  return fetch("api/sessions", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("sessions http " + String(r.status));
    return r.json() as Promise<RolloutSession[]>;
  });
}

export interface CodexStatus {
  baseDir: string;
  files: Record<string, boolean>;
}

export function fetchCodexStatus(): Promise<CodexStatus> {
  return fetch("api/codex/status", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("codex status http " + String(r.status));
    return r.json() as Promise<CodexStatus>;
  });
}

export interface CodexProject {
  id: string;
  name: string;
}

export function fetchCodexProjects(): Promise<CodexProject[]> {
  return fetch("api/codex/projects", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("codex projects http " + String(r.status));
    return r.json() as Promise<CodexProject[]>;
  });
}

export interface CodexThread {
  id: string;
  title: string;
  model: string;
  reasoningEffort: string;
  cwd: string;
  tokensUsed: number | null;
  threadSource: string;
  archived: boolean;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export function fetchCodexThreads(): Promise<CodexThread[]> {
  return fetch("api/codex/sessions?limit=200", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("codex sessions http " + String(r.status));
    return r.json() as Promise<CodexThread[]>;
  });
}

export interface CodexTurn {
  turnId: string;
  status: string;
  durationMs: number | null;
  startedAt: string;
  completedAt: string;
}

export function fetchCodexTurns(thread: string): Promise<CodexTurn[]> {
  return fetch("api/codex/turns?thread=" + encodeURIComponent(thread), {
    cache: "no-store",
  }).then((r) => {
    if (!r.ok) throw new Error("codex turns http " + String(r.status));
    return r.json() as Promise<CodexTurn[]>;
  });
}

export interface CatalogEntry {
  slug: string;
  displayName: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
  effectivePercent: number | null;
}

export function fetchCatalog(): Promise<CatalogEntry[]> {
  return fetch("api/codex/catalog", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("catalog http " + String(r.status));
    return r.json() as Promise<CatalogEntry[]>;
  });
}
