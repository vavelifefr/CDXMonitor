"use strict";
// Snapshot builder: normalized JSON view over CollectorState.
// `raw` mirrors the reference MonitorState field names 1:1 for A1 verification.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pct = pct;
exports.buildSnapshot = buildSnapshot;
function pct(part, whole) {
    if (!whole)
        return 0;
    return Math.max(0, Math.min(100, (part * 100) / whole));
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
