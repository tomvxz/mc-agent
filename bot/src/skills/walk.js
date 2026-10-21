// Low level: walk STRAIGHT in a direction (yaw in radians, the convention of the state: 0 = north,
// pi/2 = west, -pi/2 = east) for a few blocks, without the pathfinder (no path search,
// no digging, no pillaring). It jumps up one-block steps and stops in front of a wall, a drop of more
// than 3 blocks, water or lava. Useful when the pathfinder is stuck (a short way out), and to collect
// varied, short movements. Not shown to the LLM for now (see SHOWN_TO_LLM).
import { dangerAhead, facing, makeVec3, round1, sleep, WALK_SPEED } from "./utils.js";

const MAX_DISTANCE = 8;
const NO_MOVE_MS = 1500; // pushing forward without moving for this long = blocked

async function walk(bot, { yaw, distance = 1 } = {}) {
    // 1. Check the arguments
    if (!Number.isFinite(yaw) || !Number.isFinite(distance) || distance <= 0 || distance > MAX_DISTANCE)
        return {
            success: false,
            reason: "invalid_args",
            details: { yaw, distance, max_distance: MAX_DISTANCE },
        };

    const [dx, dz] = facing(yaw);
    const start = bot.entity.position.clone();
    const traveled = () => {
        const p = bot.entity.position;
        return Math.hypot(p.x - start.x, p.z - start.z);
    };
    const summary = (extra = {}) => {
        const p = bot.entity.position;
        return {
            yaw,
            start: [start.x, start.y, start.z].map(round1),
            end: [p.x, p.y, p.z].map(round1),
            traveled: round1(traveled()),
            ...extra,
        };
    };
    // A wall ahead: the block at the feet is solid and the one above it too (or no room to jump)
    const wallAhead = () => {
        const p = bot.entity.position;
        const n = Math.hypot(dx, dz);
        const x = Math.floor(p.x + (dx / n) * 0.8);
        const z = Math.floor(p.z + (dz / n) * 0.8);
        const y = Math.floor(p.y);
        const solid = (cx, cy, cz) => bot.blockAt(makeVec3(bot, cx, cy, cz))?.boundingBox === "block";
        if (!solid(x, y, z)) return null; // nothing to step over
        if (solid(x, y + 1, z) || solid(x, y + 2, z) || solid(Math.floor(p.x), y + 2, Math.floor(p.z)))
            return { block: bot.blockAt(makeVec3(bot, x, y, z)).name, position: [x, y, z] };
        return "step"; // one block high: jump
    };

    // 2. Face the direction (level gaze) and walk, checking ahead at every step
    await bot.look(yaw, 0, true);
    let lastMove = { at: Date.now(), traveled: 0 };
    try {
        while (traveled() < distance - 0.3) {
            const danger = dangerAhead(bot, dx, dz);
            if (danger) return { success: false, reason: "danger_ahead", details: summary(danger) };
            const wall = wallAhead();
            if (wall && wall !== "step") return { success: false, reason: "blocked", details: summary({ obstacle: wall }) };
            bot.setControlState("jump", wall === "step");
            bot.setControlState("forward", true);
            await sleep(50);
            if (traveled() > lastMove.traveled + 0.1) lastMove = { at: Date.now(), traveled: traveled() };
            else if (Date.now() - lastMove.at > NO_MOVE_MS)
                return { success: false, reason: "blocked", details: summary() };
        }
    } finally {
        bot.setControlState("forward", false);
        bot.setControlState("jump", false);
    }
    await sleep(200); // let the bot stop sliding
    return { success: true, reason: "ok", details: summary() };
}

// Estimated duration, for its time budget (runSkill.js)
walk.budget = (bot, { distance = 1 }) => distance / WALK_SPEED + 1;

export default walk;
export { MAX_DISTANCE };
