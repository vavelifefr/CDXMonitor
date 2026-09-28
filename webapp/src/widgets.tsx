import type { ReactNode } from "react";
import { barColor } from "./fmt";

export function Badge({ kind, text }: { kind: "na" | "est" | "aux"; text?: string }) {
  const label = text ?? (kind === "na" ? "N/A" : kind === "est" ? "EST" : "AUX");
  const bg = kind === "na" ? "#6e7681" : kind === "est" ? "#9e6a03" : "#8957e5";
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: "#fff",
        borderRadius: 4,
        padding: "0 5px",
        fontSize: 10,
        lineHeight: "16px",
        verticalAlign: "middle",
      }}
    >
      {label}
    </span>
  );
}

export function NA() {
  return <Badge kind="na" />;
}

export function Bar({ pct, invert }: { pct: number; invert?: boolean }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div
      style={{
        height: 8,
        background: "#21262d",
        borderRadius: 4,
        overflow: "hidden",
        margin: "4px 0 8px",
      }}
    >
      <div
        style={{
          height: 8,
          width: String(w) + "%",
          background: barColor(pct, invert),
          borderRadius: 4,
        }}
      />
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        borderBottom: "1px solid #21262d",
        padding: "2px 0",
      }}
    >
      <span style={{ color: "#8b949e" }}>{label}</span>
      <b style={{ textAlign: "right" }}>{value}</b>
    </div>
  );
}

export function TriTable({
  rows,
  turn,
  task,
  rollout,
}: {
  rows: Array<{ label: string; get: (m: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number }) => number; fmt: (n: number) => string }>;
  turn: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number };
  task: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number };
  rollout: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number };
}) {
  const cell: React.CSSProperties = { textAlign: "right", padding: "2px 0" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ color: "#8b949e" }}>
          <th style={{ textAlign: "left" }} />
          <th style={cell}>TURN</th>
          <th style={cell}>TASK</th>
          <th style={cell}>ROLLOUT</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} style={{ borderTop: "1px solid #21262d" }}>
            <td>{r.label}</td>
            <td style={cell}>{r.fmt(r.get(turn))}</td>
            <td style={cell}>{r.fmt(r.get(task))}</td>
            <td style={cell}>{r.fmt(r.get(rollout))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
