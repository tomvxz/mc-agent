import fs from 'node:fs'
import path from 'node:path'
import { currentRun, dataDirFor } from './run.js'

// Without a run (unit tests, or before the bot spawned), lines go to data/dev/
function dataDir() {
    const run = currentRun()
    return run ? run.data_dir : dataDirFor('dev')
}

function append(file, entry) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
}

function logTransition(entry) {
    // TRANSITIONS_FILE lets offline tests write somewhere other than the real journal
    append(process.env.TRANSITIONS_FILE || path.join(dataDir(), 'transitions.jsonl'), entry)
}

function logRun(entry) {
    append(process.env.RUNS_FILE || path.join(entry.data_dir, 'runs.jsonl'), entry)
}

export { logTransition, logRun }