// Really stopping a skill.
// runSkill stops WAITING for a skill after its time limit, but JavaScript cannot kill a running
// async function: without this module, a timed-out skill kept going in the background (seen with
// the LLM: a "ghost" mine kept walking and digging, changed the pathfinder's goal during the next
// skills and collected logs nobody asked for).
//
// How: each skill runs in its own context (AsyncLocalStorage follows it across every await). When
// the skill is over (finished or timed out), its context is marked cancelled, and every bot action
// requested FROM that context throws SkillCancelled. Actions from anywhere else (the pathfinder's
// own physics loop, the next skill, test setups) are not affected. Skills need no change.

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

class SkillCancelled extends Error {
  constructor() {
    super("the skill was stopped (time limit reached): this action is refused");
    this.name = "SkillCancelled";
  }
}

// Bot actions that a cancelled skill must not be able to do anymore
const BOT_ACTIONS = [
  "dig",
  "placeBlock",
  "activateBlock",
  "activateItem",
  "deactivateItem",
  "activateEntity",
  "attack",
  "equip",
  "unequip",
  "craft",
  "consume",
  "toss",
  "tossStack",
  "clickWindow",
  "openBlock",
  "look",
  "lookAt",
  "setControlState",
  "clearControlStates",
  "chat",
];
const PATHFINDER_ACTIONS = ["goto", "setGoal"];

// Throws SkillCancelled when called from a skill that was stopped (does nothing anywhere else).
// Also used by the waits of skills/utils.js, so that a stopped skill ends during its next wait.
function refuseIfCancelled() {
  const token = storage.getStore();
  if (token && token.cancelled) throw new SkillCancelled();
}

function guard(owner, name) {
  const original = owner[name];
  if (typeof original !== "function" || original.guardedBySkillCancel) return;
  const guarded = function (...args) {
    refuseIfCancelled();
    return original.apply(this, args);
  };
  guarded.guardedBySkillCancel = true;
  owner[name] = guarded;
}

const guardedBots = new WeakSet();
function guardBot(bot) {
  if (guardedBots.has(bot)) return;
  guardedBots.add(bot);
  for (const name of BOT_ACTIONS) guard(bot, name);
  if (bot.pathfinder)
    for (const name of PATHFINDER_ACTIONS) guard(bot.pathfinder, name);
}

// Start fn() in a new skill context. Returns its promise and cancel(), to call once the skill is over.
function startSkill(bot, fn) {
  guardBot(bot);
  const token = { cancelled: false };
  return {
    promise: storage.run(token, fn),
    cancel() {
      token.cancelled = true;
    },
  };
}

export { SkillCancelled, startSkill, refuseIfCancelled };
