// Journal lines for the skills called INSIDE a skill (mine -> collect_block -> break_block...).
// Allows to journal subcalls of a call

import { AsyncLocalStorage } from "node:async_hooks";
import { logTransition } from "../journal/logger.js";
import { observe } from "../observation/state.js";
import { resolveArgs } from "../skills/catalogue.js";

// Per bot: the next sequence number (0, 1, 2... per run), taken when a skill STARTS
const sequences = new WeakMap();
function nextSeq(bot) {
    const seq = sequences.get(bot) || 0;
    sequences.set(bot, seq + 1);
    return seq;
}

// The line being run: { seq, source, meta } (set by execute, then by each step)
const current = new AsyncLocalStorage();

// fn() or null if it throws (e.g. observing a dead bot): the transition is kept
function safe(fn) {
    try {
        const v = fn();
        return v === undefined ? null : v;
    } catch (e) {
        return null;
    }
}

// Run fn(bot, args) as the step `name` of the running skill and log its line.
// Outside a logged skill (unit tests), it only runs fn.
async function step(bot, name, fn, args = {}) {
    const parent = current.getStore();
    if (!parent) return fn(bot, args);
    const seq = nextSeq(bot);
    const startMs = Date.now();
    const tickStart = safe(() => bot.time.age);
    const before = safe(() => observe(bot));
    const runStart = Date.now(); // duration excludes the observations
    let result;
    let error = null;
    try {
        result = await current.run({ ...parent, seq }, () => fn(bot, args));
        return result;
    } catch (e) {
        error = { type: e.name, message: e.message, stack: String(e.stack || "").slice(0, 2000) };
        throw e; // the top skill reports it
    } finally {
        const endMs = Date.now();
        const tickEnd = safe(() => bot.time.age);
        logTransition({
            seq,
            parent_seq: parent.seq,
            source: parent.source,
            ...(parent.meta.episode_id !== undefined && { episode_id: parent.meta.episode_id }),
            ...(parent.meta.turn !== undefined && { turn: parent.meta.turn }),
            started_at: new Date(startMs).toISOString(),
            ended_at: new Date(endMs).toISOString(),
            tick_start: tickStart,
            tick_end: tickEnd,
            skill: { name, args, args_resolved: resolveArgs(name, args) },
            state: before,
            trace: null,
            next_state: safe(() => observe(bot)),
            settle_ticks: 0, // no settle wait between steps (a top line waits: see execute.js)
            success: result ? result.success : false,
            reason: result
                ? result.reason
                : error && error.type === "SkillCancelled"
                  ? "stopped"
                  : "exception",
            details: result ? result.details : {},
            duration: (endMs - runStart) / 1000,
            timed_out: false,
            error,
        });
    }
}

export { current, nextSeq, safe, step };
