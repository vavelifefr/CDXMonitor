// Formatting helpers (pure, UI-independent).

export function fmtTokens(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (a >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return String(Math.trunc(v));
}

export function fmtDelta(n: number): string {
  if (!n) return "0";
  return (n > 0 ? "+" : "") + String(Math.trunc(n));
}

export function fmtAge(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "n/a";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return String(s) + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return String(m) + "m " + String(s % 60).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  if (h < 48) return String(h) + "h " + String(m % 60).padStart(2, "0") + "m";
  return String(Math.floor(h / 24)) + "d " + String(h % 24).padStart(2, "0") + "h";
}

export function fmtClock(epochSec: number | null): string {
  if (epochSec === null || !epochSec) return "n/a";
  const d = new Date(epochSec * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + " " +
    p(d.getHours()) + ":" + p(d.getMinutes())
  );
}

export function barColor(pct: number, invert = false): string {
  const bad = pct >= 90;
  const warn = pct >= 75;
  if (invert) {
    if (bad) return "#3fb950";
    if (warn) return "#d29922";
    return "#f85149";
  }
  if (bad) return "#f85149";
  if (warn) return "#d29922";
  return "#3fb950";
}
