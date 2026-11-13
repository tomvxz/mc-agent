import { startTrace, summarizeForBrain } from "../journal/trace.js";
import { observe } from "../observation/state.js";
import { resolveArgs } from "../skills/catalogue.js";
import skills from "../skills/index.js";
import runSkill, { STOP_REASONS } from "./runSkill.js";
import { current, nextSeq, safe, writeLine } from "./steps.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// After a skill, wait SETTLE_TICKS server ticks before observing next_state (the inventory updates
// arrive). The client cannot wait for server ticks directly: the server only tells its age every 20
// ticks (update_time), and its ping answer does not wait for a tick (measured: 0.2-1.7 ms). So the
// wait is SETTLE_TICKS at the tick rate measured from the last two age updates: 300 ms on a healthy
// server (20 ticks/s), longer on a slow one, at most MAX_SETTLE_MS (a frozen server or a sleeping Mac).
const SETTLE_TICKS = 6;
const MAX_SETTLE_MS = 2000;

const tickRates = new WeakMap(); // bot -> { age, ms, perSecond }

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

// Run a skill and write its journal line: the state before, what happened during, the state after.
// meta (optional), when the call comes from the brain: { episode_id, turn }
// The skills it calls inside (a shortcut's primitives) get their own lines: see steps.js.
async function execute(bot, name, args = {}, source = "manual", meta = {}) {
    const known = Object.hasOwn(skills, name);
    settleMs(bot); // the first call starts measuring the tick rate
    const seq = nextSeq(bot); // given at the start: the steps inside come after it
    const startMs = Date.now();
    const tickStart = safe(() => bot.time.age);

    // 1. The state before acting
    const before = safe(() => observe(bot));

    // 2. Run the skill while recording what happens (keys, path, blocks, events: see trace.js)
    let result;
    let trace = null;
    let after;
    if (known) {
        const stopTrace = startTrace(bot);
        result = await current.run({ seq, source, meta }, () => runSkill(bot, skills[name], args));
        await sleep(settleMs(bot)); // let the inventory update
        trace = stopTrace();
        after = safe(() => observe(bot));
    } else {
        // Unknown name: nothing runs, but the failure is still logged
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
        // Only when the call comes from an LLM episode
        ...(meta.episode_id !== undefined && { episode_id: meta.episode_id }),
        ...(meta.turn !== undefined && { turn: meta.turn }),
        started_at: new Date(startMs).toISOString(),
        ended_at: new Date().toISOString(), // after the wait for the inventory
        tick_start: tickStart,
        tick_end: safe(() => bot.time.age),
        skill: { name, args, args_resolved: resolveArgs(name, args) },
        state: before,
        trace,
        next_state: after,
        // How long after the skill next_state was observed (server ticks): SETTLE_TICKS here, 0 for a
        // step (steps.js) and for an unknown skill (nothing ran: next_state = state)
        settle_ticks: known ? SETTLE_TICKS : 0,
        success: result.success,
        reason: result.reason,
        details: result.details,
        duration: result.duration,
        timed_out: result.reason === "timeout",
        error: result.error ?? null,
    });

    // 4. The brain gets the game result + a short summary of the trace (the journal keeps everything)
    const { error, ...forBrain } = result;
    // A stopped skill (time budget, no progress, alert) does not say what it had done: tell the brain
    // anyway (seen: mine stopped after collecting 8 logs, and the LLM did not know). Not in the journal:
    // it is recomputed exactly from state and next_state.
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
