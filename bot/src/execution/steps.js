// The journal lines of the skills called INSIDE a skill (mine = find + collect_block, collect_block =
// break_block + pick_up, craft walks with move_to): one line each, linked to the line of the skill that
// called it (parent_seq). A shortcut is an assembly of primitives: the world model learns from the
// primitives too, with short horizons, even when the brain asked for "mine 10".
// Not done by execute(): a step has no time budget of its own (the top skill's budget covers it, and a
// stopped top skill stops its steps) and no trace (it is the slice of the top line's trace between
// tick_start and tick_end: recomputed, not stored).

import { AsyncLocalStorage } from "node:async_hooks";
import { logTransition } from "./logger.js";
import { currentRun } from "./run.js";
import { resolveArgs } from "./skills/catalogue.js";
import { observe } from "./state.js";

// Version of the journal line format: bump it when the shape changes (see docs/journal.md)
// v1-v5: development formats. v6: simplified. v7: the steps inside a skill have their own lines
// (parent_seq), and seq is given when a skill STARTS (a parent's seq is smaller than its steps').
// v8: the state (observe) has block states, visibility, what the bot looks at, more body and entities.
// v9: a step's duration is the step itself (v8 counted its two observations too), wall_end and tick_end
// are when it ended; and every v9 state has in_sight and the radius-8 grid (early v8 lines did not).
const SCHEMA_VERSION = 9;

// Per bot: the next sequence number (0, 1, 2... per run)
const sequences = new WeakMap();
function nextSeq(bot) {
    const seq = sequences.get(bot) || 0;
    sequences.set(bot, seq + 1);
    return seq;
}

// The line being run: { seq, source, meta } (set by execute, then by each step)
const current = new AsyncLocalStorage();

// If the bot is dead or disconnected, observing throws: record null instead of losing the transition
function safe(fn) {
    try {
        const v = fn();
        return v === undefined ? null : v;
    } catch (e) {
        return null;
    }
}

// Write one transition line (writing the journal must never crash the bot)
function writeLine(line) {
    const run = currentRun();
    try {
        logTransition({
            schema_version: SCHEMA_VERSION,
            run_id: run ? run.run_id : null, // versions, seed, server settings: in runs.jsonl
            ...line,
        });
    } catch (e) {
        console.error("[journal] cannot write:", e.message);
    }
}

// Run fn(bot, args) as the step `name` of the skill being run, and log its line. Outside a logged skill
// (unit tests calling a skill directly), it only runs fn.
async function step(bot, name, fn, args = {}) {
    const parent = current.getStore();
    if (!parent) return fn(bot, args);
    const seq = nextSeq(bot);
    const startMs = Date.now();
    const tickStart = safe(() => bot.time.age);
    const before = safe(() => observe(bot));
    const runStart = Date.now(); // duration = the step itself, like runSkill's for a top skill (not the observations)
    let result;
    let error = null;
    try {
        result = await current.run({ ...parent, seq }, () => fn(bot, args));
        return result;
    } catch (e) {
        error = { type: e.name, message: e.message, stack: String(e.stack || "").slice(0, 2000) };
        throw e; // the top skill reports it (exception, or stopped)
    } finally {
        const endMs = Date.now();
        const tickEnd = safe(() => bot.time.age);
        writeLine({
            seq,
            parent_seq: parent.seq,
            source: parent.source,
            ...(parent.meta.episode_id !== undefined && { episode_id: parent.meta.episode_id }),
            ...(parent.meta.turn !== undefined && { turn: parent.meta.turn }),
            wall_start: new Date(startMs).toISOString(),
            wall_end: new Date(endMs).toISOString(), // when the step ended (before observing next_state)
            tick_start: tickStart,
            tick_end: tickEnd,
            skill: { name, args, args_resolved: resolveArgs(name, args) },
            state: before,
            trace: null,
            next_state: safe(() => observe(bot)),
            success: result ? result.success : false,
            reason: result ? result.reason : error && error.type === "SkillCancelled" ? "stopped" : "exception",
            details: result ? result.details : {},
            duration: (endMs - runStart) / 1000,
            timed_out: false,
            error,
        });
    }
}

export { current, nextSeq, safe, SCHEMA_VERSION, step, writeLine };
