import { logTransition } from "./logger.js";
import { currentRun } from "./run.js";
import runSkill from "./runSkill.js";
import { resolveArgs } from "./skills/catalogue.js";
import skills from "./skills/index.js";
import { observe } from "./state.js";
import { startTrace, summarizeForBrain } from "./trace.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Version of the journal line format: bump it when the shape changes (see docs/journal.md)
// v1-v5: development formats. v6: simplified (no context, no interventions, nothing recorded
// between skills): only what helps to understand a skill now. The data is for development only;
// the format for the world model will be fixed before the real collection run.
const SCHEMA_VERSION = 6;

// If the bot is dead or disconnected, observing throws: record null instead of losing the transition
function safe(fn) {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch (e) {
    return null;
  }
}

// Per bot: the next sequence number (0, 1, 2... per run)
const sequences = new WeakMap();
function nextSeq(bot) {
  const seq = sequences.get(bot) || 0;
  sequences.set(bot, seq + 1);
  return seq;
}

// Run a skill and write ONE journal line: the state before, what happened during, the state after.
// meta (optional), when the call comes from the brain: { episode_id, turn }
async function execute(bot, name, args = {}, source = "manual", meta = {}) {
  const known = Object.hasOwn(skills, name);
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
    result = await runSkill(bot, skills[name], args);
    await sleep(300); // let the inventory update
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

  // 3. Write the line (writing the journal must never crash the bot)
  const run = currentRun();
  try {
    logTransition({
      schema_version: SCHEMA_VERSION,
      run_id: run ? run.run_id : null, // versions, seed, server settings: in runs.jsonl
      seq: nextSeq(bot),
      source,
      // Only when the call comes from an LLM episode
      ...(meta.episode_id !== undefined && { episode_id: meta.episode_id }),
      ...(meta.turn !== undefined && { turn: meta.turn }),
      wall_start: new Date(startMs).toISOString(),
      wall_end: new Date().toISOString(),
      tick_start: tickStart,
      tick_end: safe(() => bot.time.age),
      skill: { name, args, args_resolved: resolveArgs(name, args) },
      state: before,
      trace,
      next_state: after,
      success: result.success,
      reason: result.reason,
      details: result.details,
      duration: result.duration,
      timed_out: result.reason === "timeout",
      error: result.error ?? null,
    });
  } catch (e) {
    console.error("[journal] cannot write:", e.message);
  }

  // 4. The brain gets the game result + a short summary of the trace (the journal keeps everything)
  const { error, ...forBrain } = result;
  // A stopped skill says only "timeout": tell the brain what it had done anyway (seen: mine stopped
  // after collecting 8 logs, and the LLM did not know). Not in the journal: it is recomputed exactly
  // from state and next_state.
  if (result.reason === "timeout")
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
export { inventoryChange };
