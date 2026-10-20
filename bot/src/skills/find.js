const { isHostile } = require("../state");
const { round1 } = require("./utils");

// Question (changes nothing in the world): where are the blocks or entities of a given type?
// target: a block name ("oak_log"), an entity name ("cow") or "hostile" (every monster).
// Only sees the loaded chunks around the bot.
// Search 1 to 50 blocks max
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
  let matches;

  if (block) {
    // 2a. Blocks: search for more than requested, then sort by distance
    matches = bot
      .findBlocks({
        matching: block.id,
        maxDistance: max_distance,
        count: Math.max(count * 10, 100),
      })
      .map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        distance: round1(p.distanceTo(pos)),
      }));
  } else if (target === "hostile" || bot.registry.entitiesByName[target]) {
    // 2b. Entities (the bot itself is excluded)
    const matchesTarget = (e) =>
      target === "hostile" ? isHostile(e) : e.name === target;
    matches = Object.values(bot.entities)
      .filter(
        (e) =>
          e !== bot.entity &&
          e.position &&
          matchesTarget(e) &&
          e.position.distanceTo(pos) <= max_distance,
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
      details: { target, max_distance },
    };
  return {
    success: true,
    reason: "ok",
    details: { target, matches: matches.slice(0, count) },
  };
}

module.exports = find;
