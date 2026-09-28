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
