"use strict";
// Collector state. 1:1 port of MonitorState (codex_context_monitor.py, v0.11)
// plus CDXMonitor extensions: secondary limits, cache-write, compaction, diag.
Object.defineProperty(exports, "__esModule", { value: true });
exports.zeroUsage = zeroUsage;
exports.emptyLimit = emptyLimit;
exports.initialState = initialState;
exports.asDict = asDict;
exports.asString = asString;
function zeroUsage() {
    return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}
function emptyLimit() {
    return { usedPercent: null, windowMinutes: null, resetsAt: null };
}
function initialState() {
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
        turnStats: new Map(),
        turnModels: new Map(),
        toolCalls: {},
        series: [],
    };
}
function asDict(value) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value;
    }
    return null;
}
function asString(value) {
    return typeof value === "string" ? value : "";
}
