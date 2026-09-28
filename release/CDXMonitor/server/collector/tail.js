"use strict";
// Incremental rollout reader. Port of RolloutFollower._scan_full_file
// + read_new (codex_context_monitor.py, lines 786-881). Read-only:
// the file position and the unterminated-EOF fragment are kept in memory.
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
exports.newCursor = newCursor;
exports.scanFullFile = scanFullFile;
exports.readNew = readNew;
const fs = __importStar(require("fs"));
const parse_1 = require("./parse");
function newCursor() {
    return { position: 0, partial: "" };
}
/** Full replay from byte 0. Trailing unterminated fragment is kept, not parsed. */
function scanFullFile(filePath, state, cursor) {
    cursor.partial = "";
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
    }
    catch {
        cursor.position = 0;
        cursor.partial = "";
        return;
    }
    try {
        const stat = fs.fstatSync(fd);
        const CHUNK = 1024 * 1024;
        let offset = 0;
        let carry = "";
        const buf = Buffer.alloc(CHUNK);
        while (offset < stat.size) {
            const toRead = Math.min(CHUNK, stat.size - offset);
            const n = fs.readSync(fd, buf, 0, toRead, offset);
            if (n <= 0)
                break;
            offset += n;
            const text = carry + buf.subarray(0, n).toString("utf8");
            const parts = text.split("\n");
            carry = parts.pop() ?? "";
            for (const line of parts) {
                if ((0, parse_1.lineMightMatter)(line))
                    (0, parse_1.parseJsonLine)(state, line);
            }
        }
        cursor.partial = carry;
        cursor.position = offset;
    }
    catch {
        cursor.position = 0;
        cursor.partial = "";
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch {
            // ignore
        }
    }
}
/** Read only bytes appended after cursor.position. Handles truncation. */
function readNew(filePath, state, cursor) {
    let size;
    try {
        size = fs.statSync(filePath).size;
    }
    catch {
        return;
    }
    if (size < cursor.position) {
        scanFullFile(filePath, state, cursor);
        return;
    }
    if (size === cursor.position)
        return;
    let data;
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
    }
    catch {
        return;
    }
    try {
        data = Buffer.alloc(size - cursor.position);
        fs.readSync(fd, data, 0, data.length, cursor.position);
        cursor.position = size;
    }
    catch {
        return;
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch {
            // ignore
        }
    }
    const text = cursor.partial + data.toString("utf8");
    if (!text)
        return;
    const parts = text.split("\n");
    cursor.partial = parts.pop() ?? "";
    for (const line of parts) {
        if ((0, parse_1.lineMightMatter)(line))
            (0, parse_1.parseJsonLine)(state, line.replace(/\r$/, ""));
    }
}
