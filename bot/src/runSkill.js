import { startSkill } from "./cancel.js";
import { isHostile } from "./state.js";

// When a running skill is stopped. Not one time limit for every skill (placing a block takes 1 s,
// mining 8 logs 40 s): a skill is stopped when it no longer PROGRESSES, when it goes far over its
// OWN estimate, when something needs the brain (an alert), or at a hard cap against bugs.
const HARD_CAP_S = 300; // against bugs only
// Budget: a skill may estimate its duration from game facts, skill.budget(bot, args) -> seconds
// (distance, digging time, number of blocks). It is stopped at BUDGET_FACTOR x the estimate + the
// margin; one whose stop time would pass the hard cap is refused before starting (too_long).
const BUDGET_FACTOR = 3;
const BUDGET_MARGIN_S = 10;
const DEFAULT_BUDGET_S = 60; // a skill without an estimate (craft, pick_up...): the old limit
// No progress: nothing moved, was dug or changed in the inventory for this long. Longer than the
// walking skills' own detector (gotoWatched, 8 s: reason stuck), which stays: it knows more.
const NO_PROGRESS_S = 15;
// Alerts: the bot was hurt, or a monster that was not there at the start came this close
const ALERT_DISTANCE = 6;
const CHECK_MS = 250;

// The stop time (s) of a skill for these arguments
function stopAfter(bot, skill, args) {
  try {
    const estimate = skill.budget ? skill.budget(bot, args) : null;
    if (Number.isFinite(estimate))
      return { estimate, seconds: BUDGET_FACTOR * estimate + BUDGET_MARGIN_S };
  } catch (e) {
    // e.g. invalid arguments: the skill itself will say so
  }
  return { estimate: null, seconds: DEFAULT_BUDGET_S };
}

// What counts as progress: a real move (half a block horizontally, or a climb: jumping in place is
// not), the inventory changing, digging or pillaring
function progressWatcher(bot) {
  const inventory = () =>
    bot.inventory.items().map((i) => `${i.name}:${i.count}`).join(",");
  let last = { position: bot.entity.position.clone(), inventory: inventory() };
  let lastTime = Date.now();
  return () => {
    const p = bot.entity.position;
    const now = { position: p.clone(), inventory: inventory() };
    const busy =
      bot.targetDigBlock ||
      bot.pathfinder?.isMining?.() ||
      bot.pathfinder?.isBuilding?.();
    if (
      busy ||
      Math.hypot(p.x - last.position.x, p.z - last.position.z) > 0.5 ||
      Math.abs(p.y - last.position.y) > 1.5 ||
      now.inventory !== last.inventory
    ) {
      last = now;
      lastTime = Date.now();
    }
    return (Date.now() - lastTime) / 1000; // seconds without progress
  };
}

// An alert, or null: hurt since the start, or a NEW monster close (one already close at the start
// does not count: the skill may be the answer to it, e.g. moving away)
function alertWatcher(bot) {
  const healthAtStart = bot.health;
  const near = () =>
    Object.values(bot.entities).filter(
      (e) =>
        e !== bot.entity &&
        e.position &&
        isHostile(bot, e) &&
        e.position.distanceTo(bot.entity.position) < ALERT_DISTANCE,
    );
  const atStart = new Set(near().map((e) => e.id));
  return () => {
    if (bot.health < healthAtStart)
      return { trigger: "damage", health_before: healthAtStart, health: bot.health };
    const monster = near().find((e) => !atStart.has(e.id));
    if (monster)
      return {
        trigger: "hostile_near",
        entity: monster.name,
        distance: Math.round(monster.position.distanceTo(bot.entity.position) * 10) / 10,
      };
    return null;
  };
}

// limits (tests only): { hardCapS, noProgressS }
async function runSkill(bot, skill, args, limits = {}) {
  const start = Date.now();
  const hardCap = limits.hardCapS ?? HARD_CAP_S;
  const noProgressLimit = limits.noProgressS ?? NO_PROGRESS_S;

  // 1. Its budget, before starting: refuse a skill that plans to last longer than the hard cap
  const budget = stopAfter(bot, skill, args);
  if (budget.estimate !== null && budget.seconds > hardCap)
    return {
      success: false,
      reason: "too_long",
      details: {
        estimated_seconds: Math.round(budget.estimate),
        max_seconds: Math.floor((hardCap - BUDGET_MARGIN_S) / BUDGET_FACTOR),
      },
      duration: 0,
    };

  // 2. Watch it while it runs: the first rule broken stops it
  let timer;
  let checker;
  const stopped = new Promise((_, reject) => {
    const stop = (reason, details) =>
      reject(Object.assign(new Error(reason), { stop: { reason, details } }));
    const limit = Math.min(budget.seconds, hardCap);
    timer = setTimeout(
      () =>
        stop("timeout", {
          limit: budget.seconds <= hardCap ? "budget" : "hard_cap",
          seconds: limit,
          ...(budget.estimate !== null && { estimated_seconds: Math.round(budget.estimate) }),
        }),
      limit * 1000,
    );
    // (a bot that cannot be observed, e.g. disconnected: no watching, the budget timer still runs)
    let sinceProgress = () => 0;
    let alert = () => null;
    try {
      sinceProgress = progressWatcher(bot);
      alert = alertWatcher(bot);
    } catch (e) {}
    checker = setInterval(() => {
      try {
        const a = alert();
        if (a) return stop("alert", a);
        const idle = sinceProgress();
        if (idle > noProgressLimit) stop("no_progress", { seconds: noProgressLimit });
      } catch (e) {
        // never let a watcher error escape a timer
      }
    }, CHECK_MS);
  });

  // The skill runs in its own context, so that it can be really stopped (see cancel.js)
  const running = startSkill(bot, () => skill(bot, args));

  let result;
  try {
    // Whichever finishes first wins: the skill or one of the stop rules
    result = await Promise.race([running.promise, stopped]);
  } catch (e) {
    result = e.stop
      ? { success: false, reason: e.stop.reason, details: e.stop.details }
      : {
          success: false,
          reason: "exception",
          details: { error: e.message },
          // The full error, for debugging and for the journal
          error: {
            type: e.name,
            message: e.message,
            stack: String(e.stack || "").slice(0, 2000),
          },
        };
    running.cancel(); // from now on, the skill's actions are refused (it may still be running)
    // setGoal(null) stops immediately; stop() waited for the next block
    // and made the following skill fail (instant no_path)
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    // Release the keys: a skill stopped while holding "forward" (e.g. walking onto an item)
    // would otherwise leave the bot walking on its own
    bot.clearControlStates();
  } finally {
    clearTimeout(timer);
    clearInterval(checker);
    stopped.catch(() => {}); // a stop rule that fires after the end is not an error
    // A finished skill must not act anymore either (e.g. a forgotten background wait)
    running.cancel();
    // A stopped skill may still reject later (its actions are refused): not an error to report
    running.promise.catch(() => {});
  }

  // A skill that does not return { success, reason } is a bug
  if (!result || typeof result.success !== "boolean") {
    result = {
      success: false,
      reason: "bad_result",
      details: { value: result },
    };
  }

  return { ...result, duration: (Date.now() - start) / 1000 };
}

// The reasons of a skill stopped from outside (execute adds what it had done anyway)
const STOP_REASONS = ["timeout", "no_progress", "alert"];

export default runSkill;
export { HARD_CAP_S, STOP_REASONS };
