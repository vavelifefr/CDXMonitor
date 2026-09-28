import { useEffect, useState } from "react";
import { fetchSnapshot, subscribeSnapshots, type Snapshot } from "./api";
import { fmtAge, fmtClock, fmtDelta, fmtTokens } from "./fmt";
import { Bar, NA, Row, TriTable } from "./widgets";
import "./App.css";

type Tab = "overview" | "context" | "tokens" | "limits";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "context", label: "Context" },
  { id: "tokens", label: "Tokens" },
  { id: "limits", label: "Limits" },
];

function statusOf(s: Snapshot | null, now: number): "WAIT" | "LIVE" | "IDLE" {
  if (!s || !s.activity.lastActivityEpoch) return "WAIT";
  const age = now / 1000 - s.activity.lastActivityEpoch;
  return age <= 5 ? "LIVE" : "IDLE";
}

function LimitCard({
  title,
  used,
  windowMin,
  resetsAt,
  now,
}: {
  title: string;
  used: number | null;
  windowMin: number | null;
  resetsAt: number | null;
  now: number;
}) {
  if (used === null) {
    return (
      <div className="card">
        <b>{title}</b> <NA />
      </div>
    );
  }
  const left = resetsAt !== null ? resetsAt - now / 1000 : null;
  return (
    <div className="card">
      <div className="cardTitle">
        {title} <b>{used}%</b>
      </div>
      <Bar pct={used} />
      <Row label="Окно" value={windowMin !== null ? String(windowMin) + " мин" : <NA />} />
      <Row
        label="Сброс через"
        value={left !== null ? fmtAge(left) : <NA />}
      />
      <Row label="Сброс в" value={fmtClock(resetsAt)} />
    </div>
  );
}

function Overview({ s, now }: { s: Snapshot; now: number }) {
  const st = statusOf(s, now);
  const age =
    s.activity.lastActivityEpoch > 0 ? now / 1000 - s.activity.lastActivityEpoch : null;
  return (
    <div>
      <div className="card">
        <div className="cardTitle">
          {s.model}
          {s.effort ? " " + s.effort : ""}{" "}
          <span style={{ color: st === "LIVE" ? "#3fb950" : st === "IDLE" ? "#d29922" : "#f85149" }}>
            {st}
          </span>
        </div>
        <div>
          CTX {fmtTokens(s.context.used)} / {fmtTokens(s.context.window)} (
          {s.context.fillPct.toFixed(1)}%)
        </div>
        <Bar pct={s.context.fillPct} />
        <Row label="TURN in/out" value={fmtTokens(s.turn.input) + " / " + fmtTokens(s.turn.output)} />
        <Row label="TASK in/out" value={fmtTokens(s.task.input) + " / " + fmtTokens(s.task.output)} />
        <Row
          label="ROLLOUT in/out"
          value={fmtTokens(s.rollout.input) + " / " + fmtTokens(s.rollout.output)}
        />
      </div>
      <div className="card">
        <div className="cardTitle">Лимиты</div>
        <div>
          5h: {s.limits.primary.usedPercent !== null ? s.limits.primary.usedPercent + "%" : "N/A"} ·
          weekly:{" "}
          {s.limits.secondary.usedPercent !== null ? s.limits.secondary.usedPercent + "%" : "N/A"}
        </div>
        {s.limits.primary.usedPercent !== null && <Bar pct={s.limits.primary.usedPercent} />}
        {s.limits.secondary.usedPercent !== null && <Bar pct={s.limits.secondary.usedPercent} />}
        <Row
          label="Задачи"
          value={
            String(s.tasks.started) +
            " done " +
            String(s.tasks.completed) +
            (s.tasks.running > 0 ? " running " + String(s.tasks.running) : "")
          }
        />
        <Row label="Compaction" value={String(s.compaction.count)} />
        <Row label="Usage events" value={String(s.activity.tokenEvents)} />
        <Row label="Активность" value={age !== null ? fmtAge(age) + " назад" : <NA />} />
        <Row
          label="Файл"
          value={<span className="muted">{s.file ? s.file.split(/[\\/]/).pop() : <NA />}</span>}
        />
      </div>
    </div>
  );
}

function ContextTab({ s }: { s: Snapshot }) {
  return (
    <div className="card">
      <Row label="Модель" value={s.model} />
      <Row label="Effort" value={s.effort || <NA />} />
      <Row label="Окно" value={fmtTokens(s.context.window)} />
      <Row label="Занято" value={fmtTokens(s.context.used) + " (" + s.context.fillPct.toFixed(1) + "%)"} />
      <Bar pct={s.context.fillPct} />
      <Row label="Остаток" value={fmtTokens(s.context.remaining)} />
      <Row label="Fresh" value={fmtTokens(s.context.fresh)} />
      <Row label="Cache ratio" value={s.context.cacheRatioPct.toFixed(1) + "%"} />
      <Bar pct={s.context.cacheRatioPct} invert />
      <Row label="Δ за событие" value={fmtDelta(s.context.deltaPerEvent)} />
    </div>
  );
}

function TokensTab({ s }: { s: Snapshot }) {
  return (
    <div className="card">
      <TriTable
        turn={s.turn}
        task={s.task}
        rollout={s.rollout}
        rows={[
          { label: "Input", get: (m) => m.input, fmt: fmtTokens },
          { label: "Cached", get: (m) => m.cached, fmt: fmtTokens },
          { label: "Cache-wr", get: (m) => m.cacheWrite, fmt: fmtTokens },
          { label: "Fresh", get: (m) => Math.max(0, m.input - m.cached), fmt: fmtTokens },
          { label: "Output", get: (m) => m.output, fmt: fmtTokens },
          { label: "Reasoning", get: (m) => m.reasoning, fmt: fmtTokens },
          { label: "Total", get: (m) => m.total, fmt: fmtTokens },
        ]}
      />
      <div style={{ marginTop: 8 }}>
        <Row
          label="Задачи"
          value={String(s.tasks.started) + " / done " + String(s.tasks.completed)}
        />
        <Row label="Usage events" value={String(s.activity.tokenEvents)} />
      </div>
    </div>
  );
}

function LimitsTab({ s, now }: { s: Snapshot; now: number }) {
  return (
    <div>
      <LimitCard
        title="Primary (5h)"
        used={s.limits.primary.usedPercent}
        windowMin={s.limits.primary.windowMinutes}
        resetsAt={s.limits.primary.resetsAt}
        now={now}
      />
      <LimitCard
        title="Secondary (weekly)"
        used={s.limits.secondary.usedPercent}
        windowMin={s.limits.secondary.windowMinutes}
        resetsAt={s.limits.secondary.resetsAt}
        now={now}
      />
      <div className="card">
        <Row label="Лимит" value={s.limits.limitName || <NA />} />
        <Row label="Limit ID" value={s.limits.limitId || <NA />} />
        <Row label="План" value={s.limits.planType || <NA />} />
        <Row
          label="Credits unlim"
          value={s.limits.creditsUnlimited === null ? <NA /> : String(s.limits.creditsUnlimited)}
        />
        <Row
          label="Spend control"
          value={s.limits.spendControlReached === null ? <NA /> : String(s.limits.spendControlReached)}
        />
        {s.limits.rateLimitReachedType && (
          <Row label="RL reached" value={s.limits.rateLimitReachedType} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let alive = true;
    fetchSnapshot()
      .then((s) => {
        if (alive) {
          setSnap(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    const off = subscribeSnapshots((s) => {
      if (alive) {
        setSnap(s);
        setError(null);
      }
    });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="wrap">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <div className="card error">Нет связи с сервером: {error}</div>}
      {!snap && !error && <div className="card">Загрузка…</div>}
      {snap && tab === "overview" && <Overview s={snap} now={now} />}
      {snap && tab === "context" && <ContextTab s={snap} />}
      {snap && tab === "tokens" && <TokensTab s={snap} />}
      {snap && tab === "limits" && <LimitsTab s={snap} now={now} />}
      <div className="foot">
        CDXMonitor · <a href="help.html">Помощь</a> ·{" "}
        <span className="muted">обновление по SSE</span>
      </div>
    </div>
  );
}
