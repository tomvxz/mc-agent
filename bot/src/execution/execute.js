// The single entry point to run a skill: runSkill wrapped in the journal.
// state before -> skill -> state after -> one line in transitions.jsonl.
// Always call execute to get trace of it in logs

import { startTrace, summarizeForBrain } from "../journal/trace.js";
import { observe } from "../observation/state.js";
import { resolveArgs } from "../skills/catalogue.js";
import skills from "../skills/index.js";
import runSkill, { STOP_REASONS } from "./runSkill.js";
import { current, nextSeq, safe, writeLine } from "./steps.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// next_state is observed SETTLE_TICKS server ticks after the skill, once the inventory updates have arrived.
// The client cannot wait for ticks (the server only sends its age every 20 ticks, and a ping answer does
// not wait for a tick), so the wait is converted to ms with the tick rate measured from the "time"
// updates: 300 ms at 20 ticks/s, longer on a slow server, at most MAX_SETTLE_MS.
const SETTLE_TICKS = 6;
const MAX_SETTLE_MS = 2000;

const tickRates = new WeakMap(); // bot -> { age, ms, perSecond }

// The wait (ms) before observing next_state. The first call starts measuring the tick rate.
function settleMs(bot) {
    if (!tickRates.has(bot)) {
        const rate = { age: null, ms: null, perSecond: 20 };
        tickRates.set(bot, rate);
        bot.on("time", () => {
            const age = Number(bot.time.age);
            const ms = Date.now();
            if (rate.age !== null && age > rate.age && ms > rate.ms)
                rate.perSecond = ((age - rate.age) * 1000) / (ms - rate.ms);
            rate.age = age;
            rate.ms = ms;
        });
    }
    return Math.min((SETTLE_TICKS / tickRates.get(bot).perSecond) * 1000, MAX_SETTLE_MS);
}

// Run a skill, write its journal line, and return what the brain needs:
// { success, reason, details, duration, body_events }.
// source: who asked ("manual", "api"...). meta: { episode_id, turn }, only for a call from an LLM episode.
// The skills a shortcut calls inside get their own lines: see steps.js.
async function execute(bot, name, args = {}, source = "manual", meta = {}) {
    const known = Object.hasOwn(skills, name);
    settleMs(bot);
    const seq = nextSeq(bot); // taken first: the steps inside a shortcut are numbered after it
    const startMs = Date.now();
    const tickStart = safe(() => bot.time.age);

    // 1. State before (safe: undefined instead of an exception if the bot cannot be observed)
    const before = safe(() => observe(bot));

    // 2. Run the skill while recording what happens (see trace.js)
    let result;
    let trace = null;
    let after;
    if (known) {
        const stopTrace = startTrace(bot);
        result = await current.run({ seq, source, meta }, () => runSkill(bot, skills[name], args));
        await sleep(settleMs(bot));
        trace = stopTrace();
        after = safe(() => observe(bot));
    } else {
        // Unknown name: nothing runs, the failure is still logged (next_state = state)
        result = {
            success: false,
            reason: "unknown_skill",
            details: {},
            duration: 0,
        };
        after = before;
    }

    // 3. Write the line
    writeLine({
        seq,
        source,
        // Only for a call from an LLM episode
        ...(meta.episode_id !== undefined && { episode_id: meta.episode_id }),
        ...(meta.turn !== undefined && { turn: meta.turn }),
        started_at: new Date(startMs).toISOString(),
        ended_at: new Date().toISOString(), // after the settle wait
        tick_start: tickStart,
        tick_end: safe(() => bot.time.age),
        skill: { name, args, args_resolved: resolveArgs(name, args) },
        state: before,
        trace,
        next_state: after,
        // Server ticks between the end of the skill and next_state: 0 for a step (steps.js) or an unknown skill
        settle_ticks: known ? SETTLE_TICKS : 0,
        success: result.success,
        reason: result.reason,
        details: result.details,
        duration: result.duration,
        timed_out: result.reason === "timeout",
        error: result.error ?? null,
    });

    // 4. The brain gets the result and a short summary of the trace; the journal keeps everything.
    //    `error` stays in the journal only.
    const { error, ...forBrain } = result;
    // A skill stopped from outside cannot say what it had already done (seen: mine stopped after 8 logs
    // and the LLM did not know), so add it. Not journaled: state and next_state give it exactly.
    if (STOP_REASONS.includes(result.reason))
        forBrain.details = { ...result.details, inventory_change: inventoryChange(before, after) };
    return { ...forBrain, body_events: summarizeForBrain(trace) };
}

// {item: +n or -n} between two observed states ({} if one is unknown)
function inventoryChange(before, after) {
    const a = (before && before.inventory) || {};
    const b = (after && after.inventory) || {};
    const change = {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const d = (b[name] || 0) - (a[name] || 0);
        if (d !== 0) change[name] = d;
    }
    return change;
}

export default execute;
export { inventoryChange, settleMs };
