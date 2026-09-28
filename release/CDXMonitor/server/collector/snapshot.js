"use strict";
// Snapshot builder: normalized JSON view over CollectorState.
// `raw` mirrors the reference MonitorState field names 1:1 for A1 verification.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pct = pct;
exports.resolveLimitSlots = resolveLimitSlots;
exports.buildSnapshot = buildSnapshot;
function pct(part, whole) {
    if (!whole)
        return 0;
    return Math.max(0, Math.min(100, (part * 100) / whole));
}
// Window-based slot resolution. Plans differ in which limit objects Codex
// emits (e.g. Pro may carry only a weekly window in `primary`), so slots are
// assigned by window_minutes, never by primary/secondary position:
//   240..360 min -> fiveHour; >= 10000 min -> weekly; anything else -> other.
// Unknown windows are shown generically, never mislabeled.
function resolveLimitSlots(primary, secondary) {
    const withSource = (slot, source) => ({
        usedPercent: slot.usedPercent,
        windowMinutes: slot.windowMinutes,
        resetsAt: slot.resetsAt,
        source,
    });
    const prim = withSource(primary, "primary");
    const sec = withSource(secondary, "secondary");
    let fiveHour = null;
    let weekly = null;
    const other = [];
    for (const slot of [prim, sec]) {
        if (slot.usedPercent === null)
            continue;
        const w = slot.windowMinutes;
        if (w !== null && w >= 240 && w <= 360 && fiveHour === null) {
            fiveHour = slot;
        }
        else if (w !== null && w >= 10000 && weekly === null) {
            weekly = slot;
        }
        else {
            other.push(slot);
        }
    }
    return { fiveHour, weekly, other };
}
function buildSnapshot(state) {
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
            slots: resolveLimitSlots({ ...state.primary, source: "primary" }, { ...state.secondary, source: "secondary" }),
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
