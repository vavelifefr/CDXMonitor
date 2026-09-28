// E1 CLI: replay one rollout file and print the snapshot as JSON.
// Usage: node dist/src/cli.js --file <rollout.jsonl>
//        node dist/src/cli.js --sessions <root>

import { initialState } from "./collector/types";
import { defaultSessionsRoot, newestRollout } from "./collector/classify";
import { newCursor, scanFullFile } from "./collector/tail";
import { buildSnapshot } from "./collector/snapshot";

function parseArgs(argv: string[]): { file: string | null; sessions: string | null } {
  let file: string | null = null;
  let sessions: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && i + 1 < argv.length) {
      file = argv[i + 1] as string;
      i++;
    } else if (argv[i] === "--sessions" && i + 1 < argv.length) {
      sessions = argv[i + 1] as string;
      i++;
    }
  }
  return { file, sessions };
}

function main(): number {
  const { file, sessions } = parseArgs(process.argv.slice(2));
  let target: string | null = file;
  if (!target) {
    target = newestRollout(sessions ?? defaultSessionsRoot(), null);
  }
  if (!target) {
    process.stderr.write("no rollout file found\n");
    return 1;
  }
  const state = initialState();
  const cursor = newCursor();
  scanFullFile(target, state, cursor);
  state.file = target;
  process.stdout.write(JSON.stringify(buildSnapshot(state), null, 2) + "\n");
  return 0;
}

process.exit(main());
