import mineflayerPathfinder from "mineflayer-pathfinder";
import {
    gotoWatched,
    makeVec3,
    movementFailureReason,
    round1,
    trackWorldChanges,
} from "./utils.js";
const { goals } = mineflayerPathfinder;

// Go to a position. The pathfinder deals with obstacles on its own (see src/movements.js):
// it jumps, digs a passage, pillars up with dirt, avoids lava.
// range 2 by default: the LLM rarely wants to stand exactly on a block, and a target inside a solid
// block (a log) is then reached by standing next to it. Exact moves: range 0 or 1.
async function move_to(bot, { x, y, z, range = 2 } = {}) {
    // 1. Coordinates must be numbers
    if (![x, y, z, range].every(Number.isFinite) || range < 0) {
        return {
            success: false,
            reason: "invalid_args",
            details: { x, y, z, range },
        };
    }

    const target = [x, y, z];

    // 2. A target INSIDE a solid block (e.g. a log) cannot be reached with a small range: fail at
    //    once instead of searching for 60 s (seen with the LLM). Next to it: range >= 2, or mine.
    const cell = bot.blockAt(
        makeVec3(bot, Math.floor(x), Math.floor(y), Math.floor(z)),
    );
    if (cell && cell.boundingBox === "block" && range < 2) {
        return {
            success: false,
            reason: "target_blocked",
            details: { target, block: cell.name, range },
        };
    }

    const stopTracking = trackWorldChanges(bot);
    // Where are we relative to the target, and what did we change on the way?
    const summary = () => {
        const p = bot.entity.position;
        return {
            target,
            position: [p.x, p.y, p.z].map(round1),
            distance: round1(p.distanceTo(makeVec3(bot, x, y, z))),
            ...stopTracking(),
        };
    };

    try {
        // 3. Walk until within `range` blocks of the target
        await gotoWatched(bot, new goals.GoalNear(x, y, z, range));
    } catch (e) {
        return {
            success: false,
            reason: movementFailureReason(e),
            details: { ...summary(), error: e.message },
        };
    }

    // 4. Check that we really arrived (+1 because the pathfinder counts in whole blocks)
    const arrival = summary();
    if (arrival.distance > range + 1)
        return { success: false, reason: "not_arrived", details: arrival };
    return { success: true, reason: "ok", details: arrival };
}

export default move_to;
