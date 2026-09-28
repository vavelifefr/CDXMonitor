"use strict";
// Rollout discovery and primary/auxiliary classification.
// Port of classify_rollout + RolloutFollower.newest_rollout
// (codex_context_monitor.py, lines 643-784). Read-only.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyRollout = classifyRollout;
exports.newestRollout = newestRollout;
exports.defaultSessionsRoot = defaultSessionsRoot;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
function classifyRollout(filePath) {
    let sawUserSource = false;
    let sawParent = false;
    let sawAutoReview = false;
    let sawVscodeSource = false;
    let fd = null;
    try {
        const content = readFirstLines(filePath, 256);
        for (const raw of content) {
            if (!raw.includes('"session_meta"') &&
                !raw.includes('"thread_source"') &&
                !raw.includes('"parent_thread_id"') &&
                !raw.includes('"codex-auto-review"') &&
                !raw.includes('"source"')) {
                continue;
            }
            let obj;
            try {
                obj = JSON.parse(raw);
            }
            catch {
                continue;
            }
            if (typeof obj !== "object" || obj === null)
                continue;
            const rec = obj;
            const payload = (0, types_1.asDict)(rec["payload"]);
            if (!payload)
                continue;
            if (payload["thread_source"] === "user")
                sawUserSource = true;
            if (payload["parent_thread_id"])
                sawParent = true;
            if (payload["source"] === "vscode")
                sawVscodeSource = true;
            const candidates = [payload["model"]];
            const state = (0, types_1.asDict)(payload["state"]);
            candidates.push(state ? state["model"] : null);
            const collab = (0, types_1.asDict)(payload["collaboration_mode"]);
            const settings = collab ? (0, types_1.asDict)(collab["settings"]) : null;
            candidates.push(settings ? settings["model"] : null);
            if (candidates.includes("codex-auto-review"))
                sawAutoReview = true;
            if (sawParent || sawAutoReview)
                return "auxiliary";
            if (sawUserSource)
                return "primary";
        }
    }
    catch {
        return "unknown";
    }
    finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch {
                // ignore
            }
        }
    }
    if (sawParent || sawAutoReview)
        return "auxiliary";
    if (sawUserSource || sawVscodeSource)
        return "primary";
    return "unknown";
}
function readFirstLines(filePath, maxLines) {
    const fd = fs.openSync(filePath, "r");
    try {
        const stat = fs.fstatSync(fd);
        const size = Math.min(stat.size, 1024 * 1024);
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, 0);
        const text = buf.toString("utf8");
        return text.split("\n").slice(0, maxLines);
    }
    finally {
        fs.closeSync(fd);
    }
}
function walkRollouts(sessionsRoot) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() &&
                entry.name.startsWith("rollout-") &&
                entry.name.endsWith(".jsonl")) {
                out.push(full);
            }
        }
    };
    walk(sessionsRoot);
    return out;
}
function newestRollout(sessionsRoot, explicitFile, classify = classifyRollout) {
    if (explicitFile) {
        return fs.existsSync(explicitFile) ? explicitFile : null;
    }
    if (!fs.existsSync(sessionsRoot))
        return null;
    const withMtime = [];
    for (const p of walkRollouts(sessionsRoot)) {
        try {
            withMtime.push({ mtime: fs.statSync(p).mtimeMs, p });
        }
        catch {
            // ignore disappearing files
        }
    }
    if (withMtime.length === 0)
        return null;
    withMtime.sort((a, b) => b.mtime - a.mtime);
    let newestUnknown = null;
    for (const { p } of withMtime.slice(0, 32)) {
        const kind = classify(p);
        if (kind === "primary")
            return p;
        if (kind === "unknown" && newestUnknown === null)
            newestUnknown = p;
    }
    return newestUnknown;
}
function defaultSessionsRoot() {
    const home = process.env["CODEX_HOME"];
    if (home)
        return path.join(home, "sessions");
    const userProfile = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "";
    return path.join(userProfile, ".codex", "sessions");
}
