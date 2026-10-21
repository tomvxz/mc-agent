import mineflayerPathfinder from "mineflayer-pathfinder";
import { inBlockTag } from "../tags.js";
import { gotoWatched, makeVec3, movementFailureReason } from "./utils.js";
const { goals } = mineflayerPathfinder;

// The 6 neighbours of a block: below, above, and the 4 sides
const NEIGHBOURS = [
    [0, -1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
];

// Place a block from the inventory at a position (the bot walks there on its own)
async function place_block(bot, { item, x, y, z } = {}) {
    // 1. Check the arguments
    if (typeof item !== "string" || ![x, y, z].every(Number.isInteger)) {
        return {
            success: false,
            reason: "invalid_args",
            details: { item, x, y, z },
        };
    }
    if (!bot.registry.blocksByName[item])
        return { success: false, reason: "unknown_block", details: { item } };

    const stack = bot.inventory.items().find((i) => i.name === item);
    if (!stack)
        return {
            success: false,
            reason: "not_in_inventory",
            details: { item },
        };

    // 2. The target cell must be free: air, or what the game replaces when a block is placed there
    //    (its tag minecraft:replaceable: grass, ferns, vines, water...; flowers are not in it). The tag is
    //    not the whole rule: snow is in it but the game replaces only ONE layer, the only state of it
    //    without a collision box (seen: 3 layers hid the support's face, no_path). So: in the tag AND
    //    nothing to collide with.
    const position = [x, y, z];
    const target = makeVec3(bot, x, y, z);
    const current = bot.blockAt(target);
    if (!current)
        return { success: false, reason: "not_loaded", details: { position } };
    if (!inBlockTag(bot, "replaceable", current) || current.shapes.length > 0) {
        return {
            success: false,
            reason: "occupied",
            details: { position, current: current.name },
        };
    }

    // 3. A solid block next to it is needed to "stick" the new block onto
    let support = null;
    let face = null;
    for (const [dx, dy, dz] of NEIGHBOURS) {
        const neighbour = bot.blockAt(target.offset(dx, dy, dz));
        if (neighbour && neighbour.boundingBox === "block") {
            support = neighbour;
            face = makeVec3(bot, -dx, -dy, -dz); // direction from the support to the target
            break;
        }
    }
    if (!support)
        return { success: false, reason: "no_support", details: { position } };

    try {
        // 4. Get within reach, without standing in the target cell
        await gotoWatched(
            bot,
            new goals.GoalPlaceBlock(target, bot.world, { range: 4 }),
        );
    } catch (e) {
        return {
            success: false,
            reason: movementFailureReason(e),
            details: { position, error: e.message },
        };
    }

    try {
        // 5. Hold the block and place it
        await bot.equip(stack, "hand");
        await bot.placeBlock(support, face);
    } catch (e) {
        return {
            success: false,
            reason: "place_failed",
            details: { position, error: e.message },
        };
    }

    // 6. Check that the block is really there
    const placed = bot.blockAt(target);
    if (!placed || placed.name !== item) {
        return {
            success: false,
            reason: "place_failed",
            details: { position, current: placed && placed.name },
        };
    }
    return { success: true, reason: "ok", details: { position } };
}

export default place_block;
