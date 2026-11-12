import { perceivesBlock, perceivesEntity, perception } from "../perception.js";
import { isHostile } from "../state.js";
import { findBlockTag } from "../tags.js";
import { round1 } from "./utils.js";

// Question (changes nothing in the world): where are the blocks or entities of a given type?
// target: a block name ("oak_log"), a game group of blocks ("#logs" = any log: the game's tags,
// src/tags.js), an entity name ("cow") or "hostile" (every monster).
// Only what the bot perceives (src/perception.js: by default what is in line of sight, not through
// walls), in the loaded chunks around it. 1 to 50 results, up to 64 blocks away.
const MAX_SIGHT_CHECKS = 300; // blocks checked for line of sight, nearest first
async function find(bot, { target, count = 5, max_distance = 64 } = {}) {
  // 1. Check the arguments
  const ok =
    typeof target === "string" &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 50 &&
    Number.isFinite(max_distance) &&
    max_distance > 0 &&
    max_distance <= 64;
  if (!ok)
    return {
      success: false,
      reason: "invalid_args",
      details: { target, count, max_distance },
    };

  const pos = bot.entity.position;
  const block = bot.registry.blocksByName[target];
  const group = target.startsWith("#") ? findBlockTag(bot, target.slice(1)) : null;
  let matches;

  if (block || group) {
    // 2a. Blocks: every one the client knows, nearest first, then only those perceived (a group: say
    //     which block)
    const known = bot
      .findBlocks({
        matching: group ? [...group] : block.id,
        maxDistance: max_distance,
        count: 5000,
      })
      .sort((a, b) => a.distanceTo(pos) - b.distanceTo(pos));
    const perceived = [];
    for (const p of known.slice(0, MAX_SIGHT_CHECKS)) {
      if (perceivesBlock(bot, p)) perceived.push(p);
      if (perceived.length === count) break;
    }
    matches = perceived
      .map((p) => ({
        ...(group && { block: bot.blockAt(p).name }),
        x: p.x,
        y: p.y,
        z: p.z,
        distance: round1(p.distanceTo(pos)),
      }));
  } else if (target === "hostile" || bot.registry.entitiesByName[target]) {
    // 2b. Entities (the bot itself is excluded)
    const matchesTarget = (e) =>
      target === "hostile" ? isHostile(bot, e) : e.name === target;
    matches = Object.values(bot.entities)
      .filter(
        (e) =>
          e !== bot.entity &&
          e.position &&
          matchesTarget(e) &&
          e.position.distanceTo(pos) <= max_distance &&
          perceivesEntity(bot, e),
      )
      .map((e) => ({
        name: e.name,
        x: round1(e.position.x),
        y: round1(e.position.y),
        z: round1(e.position.z),
        distance: round1(e.position.distanceTo(pos)),
      }));
  } else {
    return { success: false, reason: "unknown_target", details: { target } };
  }

  // 3. Nearest first
  matches.sort((a, b) => a.distance - b.distance);
  if (matches.length === 0)
    return {
      success: false,
      reason: "not_found",
      details: { target, max_distance, perception: perception() },
    };
  return {
    success: true,
    reason: "ok",
    details: { target, matches: matches.slice(0, count) },
  };
}

export default find;
