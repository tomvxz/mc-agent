import fs from "node:fs";
import path from "node:path";
import { currentRun, dataDirFor } from "./run.js";

// Without a run (unit tests, or before the bot spawned), lines go to data/dev/
function dataDir() {
    const run = currentRun();
    return run ? run.data_dir : dataDirFor("dev");
}

function append(file, entry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}

// Journal line format version. Changing the shape of a line = bump it and describe the new version
// in docs/journal.md (the history lives there).
const SCHEMA_VERSION = 11;

// Writes in transitions.jsonl one line per skill; a write error is logged, never thrown
function logTransition(line) {
    const run = currentRun();
    try {
        // TRANSITIONS_FILE lets offline tests write somewhere other than the real journal
        append(process.env.TRANSITIONS_FILE || path.join(dataDir(), "transitions.jsonl"), {
            schema_version: SCHEMA_VERSION,
            run_id: run ? run.run_id : null,
            ...line,
        });
    } catch (e) {
        console.error("[journal] cannot write:", e.message);
    }
}

// Writes in runs.jsonl run infos such as version, seed, etc
function logRun(entry) {
    append(process.env.RUNS_FILE || path.join(entry.data_dir, "runs.jsonl"), entry);
}

export { logRun, logTransition, SCHEMA_VERSION };
