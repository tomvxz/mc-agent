// Shortcut: dig a straight tunnel and collect EVERY block of interest that comes into sight on the way
// (all the kinds of the list in the same tunnel, veins too: they come into sight as they are uncovered)
// = dig + collect_block repeated. It only collects blocks within MAX_OFFSET of the tunnel (otherwise it
// follows a cave and is no longer a tunnel), then goes back to the tunnel and digs on.
// Ends when the time given is over (max_seconds: a normal end), when the inventory has `until`
// ({ diamond: 32, redstone: 16 }, the format of the goal condition), whichever comes first, at
// max_distance, or when the tunnel cannot go on (danger, opening onto a cave, a block it cannot break).
// Which blocks give an item, and which tool a block needs: the game's data (drops, harvestTools).
// A 1x2 tunnel only shows the blocks touching it: finding more (parallel tunnels, depth) is the brain's
// strategy, over several calls.
import { perceivedBlocks } from "../../observation/perception.js";
import { step } from "../../execution/steps.js";
import collect_block from "./collect_block.js";
import dig, { DIRECTIONS, idsOf, MAX_DISTANCE } from "../actions/dig.js";
import move_to from "../actions/move_to.js";
import { gainedSince, inventoryCounts } from "../utils.js";

const MAX_OFFSET = 4; // at most this far from the tunnel cell where the bot stopped
const MAX_COLLECTS = 30; // per stop of the tunnel (a vein is rarely bigger)
const SECONDS_PER_FIND = 20; // budget without max_seconds: a few blocks collected on the way

// The item ids a block drops (the game's data: a list of ids, or of { drop } objects in some versions)
const dropsOf = (block) =>
    (block.drops || []).map((d) => (typeof d === "object" ? (d.drop?.id ?? d.drop) : d));

async function strip_mine(bot, { direction, blocks, max_seconds, until, max_distance = 16 } = {}) {
    // 1. Check the arguments
    const ids = Array.isArray(blocks) && blocks.length > 0 ? idsOf(bot, blocks) : null;
    const untilOk =
        until === undefined ||
        (typeof until === "object" &&
            until !== null &&
            Object.entries(until).every(([item, n]) => bot.registry.itemsByName[item] && Number.isInteger(n) && n > 0));
    if (
        !DIRECTIONS[direction] ||
        !ids ||
        !untilOk ||
        !Number.isInteger(max_distance) ||
        max_distance < 1 ||
        max_distance > MAX_DISTANCE
    )
        return {
            success: false,
            reason: "invalid_args",
            details: { direction, blocks, until, max_distance, max_distance_limit: MAX_DISTANCE },
        };

    // 2. The kinds the inventory cannot harvest are removed (not a failure: details.skipped)
    const skipped = {};
    const has = (block) =>
        !block.harvestTools || bot.inventory.items().some((i) => block.harvestTools[i.type]);
    const skip = (block) =>
        (skipped[block.name] = Object.keys(block.harvestTools).map((id) => bot.registry.items[id].name));
    const kept = new Set();
    for (const id of ids) {
        const block = bot.registry.blocks[id];
        if (has(block)) kept.add(id);
        else skip(block);
    }
    // Refused at once when digging would be for nothing
    const sources = (item, among) =>
        [...among].filter((id) => dropsOf(bot.registry.blocks[id]).includes(bot.registry.itemsByName[item].id));
    for (const item of Object.keys(until || {})) {
        if (sources(item, ids).length === 0)
            return { success: false, reason: "invalid_args", details: { until_item: item, why: "no block of the list drops it" } };
        if (sources(item, kept).length === 0)
            return { success: false, reason: "no_tool", details: { until_item: item, skipped } };
    }
    if (kept.size === 0) return { success: false, reason: "no_tool", details: { skipped } };

    const before = inventoryCounts(bot);
    const deadline = Number.isFinite(max_seconds) ? Date.now() + max_seconds * 1000 : Infinity;
    const untilMet = () =>
        until !== undefined &&
        Object.entries(until).every(([item, n]) => (inventoryCounts(bot)[item] || 0) - (before[item] || 0) >= n);
    const tried = new Set();
    const broken = {};
    let dug = 0;
    const end = (stoppedBy, failure = null) => {
        const success = !failure && (until === undefined || untilMet());
        return {
            success,
            reason: failure ? failure.reason : success ? "ok" : "partial",
            details: {
                collected: gainedSince(bot, before),
                dug,
                broken,
                ...(Object.keys(skipped).length && { skipped }),
                ...(stoppedBy && { stopped_by: stoppedBy }),
                ...(failure && failure.details),
            },
        };
    };

    while (true) {
        if (untilMet()) return end("until");
        if (Date.now() >= deadline) return end("time");

        // 3. Collect every block of interest in sight near the tunnel, nearest first
        const p = bot.entity.position;
        const axis = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        for (let n = 0; n < MAX_COLLECTS && !untilMet() && Date.now() < deadline; n++) {
            const here = bot.entity.position;
            const target = perceivedBlocks(bot, kept)
                .filter(
                    (b) =>
                        !tried.has(`${b.x},${b.y},${b.z}`) &&
                        Math.hypot(b.x - axis.x, b.y - axis.y, b.z - axis.z) <= MAX_OFFSET,
                )
                .sort(
                    (a, b) =>
                        Math.hypot(a.x - here.x, a.y - here.y, a.z - here.z) -
                        Math.hypot(b.x - here.x, b.y - here.y, b.z - here.z),
                )[0];
            if (!target) break;
            tried.add(`${target.x},${target.y},${target.z}`);
            const r = await step(bot, "collect_block", collect_block, { x: target.x, y: target.y, z: target.z });
            if (r.reason === "no_tool") {
                // The tool broke on the way: this kind is skipped from now on
                const block = bot.registry.blocksByName[target.name];
                kept.delete(block.id);
                skip(block);
                if (kept.size === 0) return end(null, { reason: "no_tool", details: {} });
            }
        }
        if (untilMet()) return end("until");
        if (Date.now() >= deadline) return end("time");

        // 4. Back to the tunnel if collecting moved the bot away
        const q = bot.entity.position;
        if (Math.hypot(q.x - (axis.x + 0.5), q.z - (axis.z + 0.5)) > 0.5 || Math.floor(q.y) !== axis.y) {
            const back = await step(bot, "move_to", move_to, { x: axis.x + 0.5, y: axis.y, z: axis.z + 0.5, range: 0 });
            if (!back.success) return end(null, back);
        }
        if (dug >= max_distance) return end("distance");

        // 5. Dig on until a block of interest comes into sight
        const left = Number.isFinite(deadline) ? { max_seconds: (deadline - Date.now()) / 1000 } : {};
        const names = [...kept].map((id) => bot.registry.blocks[id].name);
        const r = await step(bot, "dig", dig, { direction, distance: max_distance - dug, stop_at: names, ...left });
        dug += r.details.dug || 0;
        for (const [name, n] of Object.entries(r.details.broken || {})) broken[name] = (broken[name] || 0) + n;
        if (!r.success) {
            // The tunnel cannot go on: danger_ahead, opening (a cave), no_tool, blocked...
            const { position, danger, tools, block } = r.details;
            return end(null, { reason: r.reason, details: { position, danger, tools, block } });
        }
        if (r.details.stopped_by === "time") return end("time");
        // "found": collect it; "distance": collect what the last step showed, then stop (step 4)
    }
}

// Estimated duration, for its time budget (runSkill.js): the time given, or digging max_distance
strip_mine.budget = (bot, { direction, max_seconds, max_distance = 16 }) =>
    Number.isFinite(max_seconds)
        ? max_seconds
        : dig.budget(bot, { direction, distance: max_distance }) + SECONDS_PER_FIND;

export default strip_mine;
