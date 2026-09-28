import { useEffect, useState } from "react";
import {
  fetchActivity,
  fetchAggregate,
  fetchCatalog,
  fetchCodexProjects,
  fetchCodexStatus,
  fetchCodexThreads,
  fetchCodexTurns,
  fetchReviews,
  fetchRollouts,
  fetchSnapshot,
  fetchTurns,
  setActiveSession,
  subscribeSnapshots,
  type ActivityResponse,
  type AggregateResponse,
  type CatalogEntry,
  type CodexProject,
  type CodexStatus,
  type CodexThread,
  type CodexTurn,
  type ReviewsResponse,
  type RolloutSession,
  type Snapshot,
  type TurnsResponse,
  type TurnView,
} from "./api";
import { fmtAge, fmtClock, fmtDelta, fmtTokens } from "./fmt";
import { Badge, Bar, NA, Row, TriTable } from "./widgets";
import "./App.css";

type Tab =
  | "overview"
  | "context"
  | "tokens"
  | "limits"
  | "turns"
  | "tools"
  | "sessions"
  | "codexdb";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "context", label: "Context" },
  { id: "tokens", label: "Tokens" },
  { id: "limits", label: "Limits" },
  { id: "turns", label: "Turns" },
  { id: "tools", label: "Tools" },
  { id: "sessions", label: "Sessions" },
  { id: "codexdb", label: "CodexDB" },
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

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

function RefreshLine({ text, onRefresh }: { text: string; onRefresh: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="muted" style={{ fontSize: 11 }}>{text}</span>
      <button className="tab" style={{ flex: "none", padding: "2px 10px" }} onClick={onRefresh}>
        Обновить
      </button>
    </div>
  );
}

function TurnsTab({ now }: { now: number }) {
  const [data, setData] = useState<TurnsResponse | null>(null);
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const load = (refresh: boolean) => {
    fetchTurns(refresh)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    load(false);
    const timer = window.setInterval(() => load(false), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (error) return <div className="card error">Туры: {error}</div>;
  if (!data) return <div className="card">Загрузка туров…</div>;
  const models = Array.from(new Set(data.turns.map((t) => t.model).filter(Boolean))).sort();
  const rows = data.turns.filter((t) => modelFilter === "all" || t.model === modelFilter);
  const age = Math.max(0, Math.round(now / 1000 - Date.parse(data.updatedAt) / 1000));
  return (
    <div>
      <div className="card">
        <RefreshLine text={"обновлено " + fmtAge(age) + " назад · авто каждые 30 c"} onRefresh={() => load(true)} />
        <div style={{ margin: "6px 0" }}>
          <label className="muted" style={{ fontSize: 11 }}>Модель: </label>
          <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
            <option value="all">все ({data.turns.length})</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "#8b949e" }}>
              <th style={{ textAlign: "left" }}>Тур</th>
              <th style={{ textAlign: "left" }}>Модель</th>
              <th style={{ textAlign: "right" }}>In</th>
              <th style={{ textAlign: "right" }}>Out</th>
              <th style={{ textAlign: "right" }}>Соб.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: TurnView) => (
              <tr key={t.id} style={{ borderTop: "1px solid #21262d" }}>
                <td title={t.id}>{shortId(t.id)}</td>
                <td>{t.model || <NA />}</td>
                <td style={{ textAlign: "right" }}>{fmtTokens(t.input)}</td>
                <td style={{ textAlign: "right" }}>{fmtTokens(t.output)}</td>
                <td style={{ textAlign: "right" }}>{t.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ToolsTab() {
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [reviews, setReviews] = useState<ReviewsResponse | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  useEffect(() => {
    fetchActivity().then(setActivity).catch(() => undefined);
  }, []);
  const tools = activity ? Object.entries(activity.tools).sort((a, b) => b[1] - a[1]) : [];
  return (
    <div>
      <div className="card">
        <div className="cardTitle">Активность инструментов</div>
        {tools.length === 0 && <span className="muted">пока пусто</span>}
        {tools.map(([name, count]) => (
          <Row key={name} label={name} value={String(count)} />
        ))}
      </div>
      <div className="card">
        <div className="cardTitle">Цена review-детей</div>
        {!reviews && (
          <button className="tab" style={{ width: "100%" }} disabled={busy} onClick={() => {
            setBusy(true);
            fetchReviews(true)
              .then(setReviews)
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}>
            {busy ? "Считаю…" : "Посчитать (сканирует auxiliary-файлы)"}
          </button>
        )}
        {reviews && (
          <div>
            <Row label="Всего in" value={fmtTokens(reviews.totalInput)} />
            <Row label="Всего out" value={fmtTokens(reviews.totalOutput)} />
            <Row label="Файлов" value={String(reviews.files.length)} />
            {reviews.files.slice(0, 10).map((f) => (
              <Row key={f.id} label={shortId(f.id)} value={fmtTokens(f.input) + " / " + fmtTokens(f.output)} />
            ))}
            <div className="muted" style={{ fontSize: 11 }}>посчитано {reviews.updatedAt}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionsTab() {
  const [rollouts, setRollouts] = useState<RolloutSession[] | null>(null);
  const [series, setSeries] = useState<Array<{ t: number; input: number }>>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<AggregateResponse | null>(null);
  const load = () => {
    fetchRollouts().then(setRollouts).catch(() => undefined);
    fetchActivity()
      .then((a) => setSeries(a.series))
      .catch(() => undefined);
    fetchSnapshot()
      .then((s) => setActiveFile(s.file ? s.file.split(/[\\/]/).pop() ?? null : null))
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);
  const choose = (id: string) => {
    setActiveSession(id)
      .then((r) => setActiveFile(r.file))
      .catch(() => undefined);
  };
  const points = series.slice(-120);
  const max = points.reduce((m, p) => Math.max(m, p.input), 1);
  return (
    <div>
      <div className="card">
        <div className="cardTitle">Суммарно по primary-сессиям</div>
        {!aggregate && (
          <button className="tab" style={{ width: "100%" }} onClick={() => {
            fetchAggregate(true).then(setAggregate).catch(() => undefined);
          }}>
            Посчитать
          </button>
        )}
        {aggregate && (
          <div>
            <Row label="Всего in" value={fmtTokens(aggregate.totalInput)} />
            <Row label="Всего out" value={fmtTokens(aggregate.totalOutput)} />
            <Row label="Файлов" value={String(aggregate.files.length)} />
            <div className="muted" style={{ fontSize: 11 }}>посчитано {aggregate.updatedAt}</div>
          </div>
        )}
      </div>
      <div className="card">
        <div className="cardTitle">Временная ось активной сессии (контекст)</div>
        {points.length === 0 && <span className="muted">пока нет событий</span>}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 40 }}>
          {points.map((p, i) => (
            <div
              key={i}
              title={new Date(p.t).toLocaleString() + " " + fmtTokens(p.input)}
              style={{
                flex: 1,
                height: Math.max(2, Math.round((p.input / max) * 40)),
                background: "#1f6feb",
              }}
            />
          ))}
        </div>
      </div>
      <div className="card">
        <RefreshLine text={"файлов: " + String(rollouts ? rollouts.length : 0)} onRefresh={load} />
        {rollouts &&
          rollouts.slice(0, 20).map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #21262d", padding: "3px 0" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.id}>
                {r.kind === "auxiliary" ? <Badge kind="aux" /> : null} {shortId(r.id)}
              </span>
              {activeFile === r.id ? (
                <b style={{ color: "#3fb950", fontSize: 11 }}>активна</b>
              ) : (
                <button className="tab" style={{ flex: "none", padding: "0 8px", fontSize: 11 }} onClick={() => choose(r.id)}>
                  Выбрать
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

function CodexDBTab() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [projects, setProjects] = useState<CodexProject[] | null>(null);
  const [threads, setThreads] = useState<CodexThread[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<CodexTurn[] | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const load = () => {
    setBusy(true);
    Promise.all([fetchCodexStatus(), fetchCodexProjects(), fetchCodexThreads(), fetchCatalog()])
      .then(([st, pr, th, cat]) => {
        setStatus(st);
        setProjects(pr);
        setThreads(th);
        setCatalog(cat);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const showTurns = (threadId: string) => {
    if (openThread === threadId) {
      setOpenThread(null);
      return;
    }
    setOpenThread(threadId);
    setTurns(null);
    fetchCodexTurns(threadId).then(setTurns).catch(() => setTurns([]));
  };
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? shortId(id);
  return (
    <div>
      <div className="card">
        <RefreshLine
          text={status ? "SQLite Codex: ручное обновление" + (Object.values(status.files).every(Boolean) ? "" : " (часть файлов N/A)") : "SQLite Codex: нажмите «Обновить»"}
          onRefresh={load}
        />
        {busy && <span className="muted">Читаю…</span>}
      </div>
      {catalog && catalog.length > 0 && (
        <div className="card">
          <div className="cardTitle">Окна каталога</div>
          {catalog.map((c) => (
            <Row
              key={c.slug}
              label={c.displayName || c.slug}
              value={fmtTokens(c.contextWindow ?? 0) + " / max " + fmtTokens(c.maxContextWindow ?? 0)}
            />
          ))}
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="card">
          <div className="cardTitle">Проекты ({projects.length})</div>
          {projects.map((p) => (
            <Row key={p.id} label={p.name || shortId(p.id)} value={String(threads?.filter((t) => t.projectId === p.id).length ?? 0) + " тредов"} />
          ))}
        </div>
      )}
      {threads && (
        <div className="card">
          <div className="cardTitle">Сессии Codex ({threads.length})</div>
          {threads.slice(0, 30).map((t) => (
            <div key={t.id} style={{ borderTop: "1px solid #21262d", padding: "4px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title || shortId(t.id)}
                </b>
                <button className="tab" style={{ flex: "none", padding: "0 8px", fontSize: 11 }} onClick={() => showTurns(t.id)}>
                  Туры
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {t.model || "n/a"} · {t.tokensUsed !== null ? fmtTokens(t.tokensUsed) : "n/a"} · {projectName(t.projectId)}
                {t.archived ? " · archived" : ""}
              </div>
              {openThread === t.id && (
                <div style={{ marginTop: 4 }}>
                  {!turns && <span className="muted">Читаю туры…</span>}
                  {turns && turns.length === 0 && <span className="muted">туров нет</span>}
                  {turns && turns.map((tr) => (
                    <Row
                      key={tr.turnId}
                      label={shortId(tr.turnId) + " " + (tr.status || "")}
                      value={tr.durationMs !== null ? fmtAge(tr.durationMs / 1000) : <NA />}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
      {tab === "turns" && <TurnsTab now={now} />}
      {tab === "tools" && <ToolsTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "codexdb" && <CodexDBTab />}
      <div className="foot">
        CDXMonitor · <a href="help.html">Помощь</a> ·{" "}
        <span className="muted">обновление по SSE</span>
      </div>
    </div>
  );
}
