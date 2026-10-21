// Shortcut: mine `count` blocks of a type = find + collect_block (break_block + pick_up), repeated.
// It is only an assembly of primitives (see CLAUDE.md, skill philosophy).
import collect_block from "./collect_block.js";
import find from "./find.js";
import { step } from "../steps.js";
import { findBlockTag } from "../tags.js";
import { gainedSince, inventoryCounts, walkSeconds } from "./utils.js";

// Failures that only concern THIS block: try the next one (not_collected: its item fell out of reach)
const TRY_ANOTHER = [
    "no_path",
    "path_timeout",
    "interrupted",
    "stuck",
    "nothing_to_break",
    "not_collected",
];
const MAX_ATTEMPTS = 20;
// Same reach as find's default: otherwise mine says block_not_found where find sees a log (seen at 42 blocks)
const SEARCH_RADIUS = 64;
// Measured on the journal (2026-10-21, logs): about 5 s per block (find, walk, dig, pick up). With the
// budget rule (stopped at 3x + 10 s, at most 300 s), this allows up to ~18 blocks per call: beyond, the
// call is refused (too_long) and the brain repeats mine (a tactic will do it without the LLM).
const SECONDS_PER_BLOCK = 5;

async function mine(bot, { block, count = 1 } = {}) {
    // 1. Check the arguments: a block name, or a game group of blocks ('#logs' = any log, see find)
    const group = typeof block === "string" && block.startsWith("#") && findBlockTag(bot, block.slice(1));
    if (!bot.registry.blocksByName[block] && !group)
        return { success: false, reason: "unknown_block", details: { block } };
    if (!Number.isInteger(count) || count < 1)
        return { success: false, reason: "invalid_args", details: { count } };

    const before = inventoryCounts(bot);
    const total = () =>
        Object.values(gainedSince(bot, before)).reduce((a, b) => a + b, 0);
    const tried = new Set(); // positions already attempted, so the same block is never targeted twice
    let dug = 0;
    let unreachable = 0;
    let cleared = 0; // blocks broken only to see a target (leaves...): what the trip cost

    while (dug < count) {
        // 2. The nearest block not tried yet
        const found = await step(bot, "find", find, {
            target: block,
            count: 50,
            max_distance: SEARCH_RADIUS,
        });
        const target =
            found.success &&
            found.details.matches.find(
                (m) => !tried.has(`${m.x},${m.y},${m.z}`),
            );
        if (!target || tried.size >= MAX_ATTEMPTS) {
            const reason =
                dug > 0
                    ? "partial"
                    : unreachable > 0
                      ? "no_path"
                      : "block_not_found";
            return {
                success: false,
                reason,
                details: {
                    dug,
                    collected: gainedSince(bot, before),
                    unreachable,
                },
            };
        }
        tried.add(`${target.x},${target.y},${target.z}`);

        // 3. Break it and pick up what drops (collect_block walks there on its own)
        const r = await step(bot, "collect_block", collect_block, {
            x: target.x,
            y: target.y,
            z: target.z,
        });
        cleared += r.details.cleared || 0;
        if (r.success) {
            dug++;
        } else if (TRY_ANOTHER.includes(r.reason)) {
            unreachable++;
        } else {
            // no_tool, unbreakable, dig_failed...: the next block would fail the same way
            return {
                success: false,
                reason: r.reason,
                details: {
                    dug,
                    collected: gainedSince(bot, before),
                    ...r.details,
                },
            };
        }
    }

    // 4. Breaking is not enough: something must have been collected per block
    if (total() < dug)
        return {
            success: false,
            reason: "not_collected",
            details: { dug, collected: gainedSince(bot, before), ...(cleared && { cleared }) },
        };
    return {
        success: true,
        reason: "ok",
        details: { dug, collected: gainedSince(bot, before), unreachable, ...(cleared && { cleared }) },
    };
}

// Estimated duration, for its time budget (runSkill.js): walking to the nearest block of the type (an
// estimate: any block the client knows) + SECONDS_PER_BLOCK per block. Without the walk, a log found
// 58 blocks away was stopped on the way (budget 40 s, seen 2026-10-21).
function walkToNearest(bot, block) {
    const group = typeof block === "string" && block.startsWith("#") && findBlockTag(bot, block.slice(1));
    const ids = group ? [...group] : [bot.registry.blocksByName[block].id];
    const nearest = bot.findBlock({ matching: ids, maxDistance: SEARCH_RADIUS });
    return nearest ? walkSeconds(bot, nearest.position.x, nearest.position.y, nearest.position.z) : 0;
}
mine.budget = (bot, { block, count = 1 }) => walkToNearest(bot, block) + SECONDS_PER_BLOCK * count + 5;

export default mine;
