"use strict";
// E1 CLI: replay one rollout file and print the snapshot as JSON.
// Usage: node dist/src/cli.js --file <rollout.jsonl>
//        node dist/src/cli.js --sessions <root>
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./collector/types");
const classify_1 = require("./collector/classify");
const tail_1 = require("./collector/tail");
const snapshot_1 = require("./collector/snapshot");
function parseArgs(argv) {
    let file = null;
    let sessions = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--file" && i + 1 < argv.length) {
            file = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--sessions" && i + 1 < argv.length) {
            sessions = argv[i + 1];
            i++;
        }
    }
    return { file, sessions };
}
function main() {
    const { file, sessions } = parseArgs(process.argv.slice(2));
    let target = file;
    if (!target) {
        target = (0, classify_1.newestRollout)(sessions ?? (0, classify_1.defaultSessionsRoot)(), null);
    }
    if (!target) {
        process.stderr.write("no rollout file found\n");
        return 1;
    }
    const state = (0, types_1.initialState)();
    const cursor = (0, tail_1.newCursor)();
    (0, tail_1.scanFullFile)(target, state, cursor);
    state.file = target;
    process.stdout.write(JSON.stringify((0, snapshot_1.buildSnapshot)(state), null, 2) + "\n");
    return 0;
}
process.exit(main());
