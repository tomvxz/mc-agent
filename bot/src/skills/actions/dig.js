// Primitive: dig a straight tunnel the size of the bot (1 wide, 2 high) in a direction, block after block,
// and walk into it. slope "up" / "down": a staircase (one block up or down per step), never straight up or
// down (falls, lava, gravel). The way to uncover what is hidden: each block broken shows the next ones
// (break_block refuses a block not in sight). stop_at: stop as soon as a block of these kinds COMES into
// sight (one already in sight when it starts does not count: otherwise a block skipped earlier would stop
// it at every step). Instincts, like walk: it never breaks a block next to lava or water (it would flow
// into the tunnel), and stops where the tunnel opens onto a void (a cave) instead of falling.
import { perceivedBlocks } from "../../observation/perception.js";
import { step } from "../../execution/steps.js";
import { findBlockTag, isFluid } from "../../game/tags.js";
import break_block, { digSeconds } from "./break_block.js";
import { makeVec3, round1, sleep } from "../utils.js";

const DIRECTIONS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const SLOPES = { level: 0, up: 1, down: -1 };
const MAX_DISTANCE = 64;
const MAX_REDIGS = 8; // gravel or sand falling into a cell: dig it again, at most this many times per step
const MOVE_MS = 3000; // stepping into the dug cell takes longer than this = blocked
const SECONDS_PER_BREAK = 1.2; // looking, equipping, waiting for the drop (break_block)
const SECONDS_PER_MOVE = 0.6;

// Block ids of names and game groups ('#diamond_ores'), or null if one is unknown
function idsOf(bot, kinds) {
    const ids = new Set();
    for (const kind of kinds) {
        const group = typeof kind === "string" && kind.startsWith("#") && findBlockTag(bot, kind.slice(1));
        const block = bot.registry.blocksByName[kind];
        if (!group && !block) return null;
        for (const id of group || [block.id]) ids.add(id);
    }
    return ids;
}

// The cells of one step from the feet cell (x, y, z), in the order they must be broken (each one is in
// sight once the previous ones are gone), the new feet cell, and the cell that must hold the bot up
function stepCells([x, y, z], [dx, dz], slope) {
    const v = (cx, cy, cz) => ({ x: cx, y: cy, z: cz });
    const [nx, nz] = [x + dx, z + dz];
    if (slope === 1)
        return {
            dig: [v(x, y + 2, z), v(nx, y + 1, nz), v(nx, y + 2, nz)],
            feet: v(nx, y + 1, nz),
            floor: v(nx, y, nz),
        };
    if (slope === -1)
        return {
            dig: [v(nx, y + 1, nz), v(nx, y, nz), v(nx, y - 1, nz)],
            feet: v(nx, y - 1, nz),
            floor: v(nx, y - 2, nz),
        };
    return { dig: [v(nx, y + 1, nz), v(nx, y, nz)], feet: v(nx, y, nz), floor: v(nx, y - 1, nz) };
}

// Step into the cell just dug (feet cell `cell`), controlled at EVERY physics tick. Checking every 50 ms was
// not enough (arena, 2026-11-12): when Node is busy (e.g. building the journal's grid), the physics catches up
// with several ticks at once, the bot passed the cell between two checks, kept walking and fell off the edge
// of an opening. Mineflayer emits physicsTick after EACH simulated tick, even when they come in a burst, so
// here the keys are released at the latest on the tick the bot comes RELEASE_BEFORE from the cell's center
// along the tunnel (or passes it); it then slides to a stop (~0.2 block). Arrived = standing still, on the
// ground, with its feet in the cell. Returns true if arrived.
const RELEASE_BEFORE = 0.3;
const STILL_TICKS = 3; // ticks without horizontal movement = stopped
function stepInto(bot, cell, heading, jump, maxMs = MOVE_MS) {
    const cx = cell.x + 0.5;
    const cz = cell.z + 0.5;
    return new Promise((resolve) => {
        let pressed = true;
        let still = 0;
        const release = () => {
            pressed = false;
            try {
                bot.setControlState("forward", false);
                bot.setControlState("jump", false); // jumping on would keep it off the ground
            } catch (e) {
                // a stopped skill: its keys are refused, and runSkill has released them anyway
            }
        };
        const finish = (arrived) => {
            clearTimeout(timer);
            bot.removeListener("physicsTick", onTick);
            release();
            resolve(arrived);
        };
        const onTick = () => {
            const p = bot.entity.position;
            const left = (cx - p.x) * heading[0] + (cz - p.z) * heading[1]; // still to go along the tunnel
            if (pressed && left < RELEASE_BEFORE) release();
            if (pressed) return;
            const v = bot.entity.velocity;
            const stopped = bot.entity.onGround && Math.hypot(v.x, v.z) < 0.01;
            still = stopped ? still + 1 : 0;
            if (still < STILL_TICKS) return;
            finish(
                Math.floor(p.x) === cell.x && Math.floor(p.z) === cell.z && Math.floor(p.y + 0.01) === cell.y,
            );
        };
        const timer = setTimeout(() => finish(false), maxMs);
        bot.on("physicsTick", onTick);
        bot.setControlState("forward", true);
        bot.setControlState("jump", jump);
    });
}

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

async function dig(bot, { direction, distance = 8, slope = "level", stop_at, max_seconds } = {}) {
    // 1. Check the arguments
    const stopIds = stop_at === undefined ? new Set() : Array.isArray(stop_at) ? idsOf(bot, stop_at) : null;
    if (
        !DIRECTIONS[direction] ||
        !Object.hasOwn(SLOPES, slope) ||
        !Number.isInteger(distance) ||
        distance < 1 ||
        distance > MAX_DISTANCE ||
        !stopIds
    )
        return {
            success: false,
            reason: "invalid_args",
            details: { direction, distance, slope, stop_at, max_distance: MAX_DISTANCE },
        };
    const heading = DIRECTIONS[direction];
    const rise = SLOPES[slope];
    // The time given by the brain (runSkill stops it a little later; inside strip_mine, the time left)
    const deadline = Number.isFinite(max_seconds) ? Date.now() + max_seconds * 1000 : Infinity;

    const at = (c) => bot.blockAt(makeVec3(bot, c.x, c.y, c.z));
    const feetCell = () => {
        const p = bot.entity.position;
        return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    };
    const start = bot.entity.position.clone();
    const broken = {};
    const seenAtStart = new Set(
        stopIds.size ? perceivedBlocks(bot, stopIds).map((b) => `${b.x},${b.y},${b.z}`) : [],
    );
    let dug = 0;
    const result = (success, reason, extra = {}) => {
        const p = bot.entity.position;
        return {
            success,
            reason,
            details: {
                direction,
                slope,
                dug,
                broken,
                start: [start.x, start.y, start.z].map(round1),
                end: [p.x, p.y, p.z].map(round1),
                ...extra,
            },
        };
    };

    while (dug < distance) {
        if (Date.now() >= deadline) return result(true, "ok", { stopped_by: "time" });
        const cells = stepCells(feetCell(), heading, rise);

        // 2. Clear the cells of this step (again if gravel or sand falls in)
        for (let pass = 0; ; pass++) {
            const solid = cells.dig.filter((c) => {
                const b = at(c);
                return b && (b.boundingBox === "block" || isFluid(bot, b));
            });
            if (cells.dig.some((c) => !at(c))) return result(false, "not_loaded");
            if (solid.length === 0) break;
            if (pass >= MAX_REDIGS) return result(false, "blocked", { position: [solid[0].x, solid[0].y, solid[0].z] });
            for (const c of solid) {
                // Instinct: a liquid in the cell or next to it would flow into the tunnel
                const wet = [c, ...NEIGHBORS.map(([a, b, d]) => ({ x: c.x + a, y: c.y + b, z: c.z + d }))]
                    .map(at)
                    .find((b) => b && isFluid(bot, b));
                if (wet) return result(false, "danger_ahead", { danger: wet.name === "lava" ? "lava" : "water" });
                const name = at(c).name;
                const r = await step(bot, "break_block", break_block, c);
                if (!r.success) {
                    // no_tool (stone without a pickaxe), unbreakable (bedrock)...: the tunnel cannot go on
                    const { position, tools } = r.details;
                    return result(false, r.reason, { position, ...(tools && { tools }), block: r.details.block });
                }
                broken[name] = (broken[name] || 0) + 1;
            }
            await sleep(300); // a falling block takes a few ticks to land
        }

        // 3. Something must hold the bot up in the new cell (otherwise the tunnel opens onto a void)
        const floor = at(cells.floor);
        if (!floor) return result(false, "not_loaded");
        if (floor.boundingBox !== "block")
            return result(false, "opening", { position: [cells.floor.x, cells.floor.y, cells.floor.z], block: floor.name });

        // 4. Step into it (jump for a step up), facing the tunnel
        const target = makeVec3(bot, cells.feet.x + 0.5, cells.feet.y, cells.feet.z + 0.5);
        await bot.lookAt(target.offset(heading[0], 1.6, heading[1]), true);
        const arrived = await stepInto(bot, cells.feet, heading, rise === 1);
        if (!arrived) return result(false, "blocked", { position: [cells.feet.x, cells.feet.y, cells.feet.z] });
        dug++;

        // 5. Did a block of interest come into sight?
        if (stopIds.size) {
            const found = perceivedBlocks(bot, stopIds).filter((b) => !seenAtStart.has(`${b.x},${b.y},${b.z}`));
            if (found.length) return result(true, "ok", { stopped_by: "found", found });
        }
    }
    return result(true, "ok", { stopped_by: "distance" });
}

// Estimated duration, for its time budget (runSkill.js): the game's digging time of the cells on the
// way (the client knows them: an estimate, never told to the brain) + looking, picking up and stepping.
// Up to the first cell it cannot dig (a tool missing: it stops there, no_tool), not as if dug by hand:
// otherwise stone without a pickaxe was refused as too_long instead of no_tool (seen in the arena).
dig.budget = (bot, { direction, distance = 8, slope = "level" }) => {
    const p = bot.entity.position;
    let feet = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    let seconds = 0;
    const tools = new Set(bot.inventory.items().map((i) => i.type));
    for (let i = 0; i < distance; i++) {
        const cells = stepCells(feet, DIRECTIONS[direction], SLOPES[slope]);
        for (const c of cells.dig) {
            const b = bot.blockAt(makeVec3(bot, c.x, c.y, c.z));
            if (!b || b.boundingBox !== "block") continue;
            if (b.harvestTools && !Object.keys(b.harvestTools).some((id) => tools.has(Number(id)))) return seconds;
            seconds += digSeconds(bot, c) + SECONDS_PER_BREAK;
        }
        seconds += SECONDS_PER_MOVE;
        feet = [cells.feet.x, cells.feet.y, cells.feet.z];
    }
    return seconds;
};

export default dig;
export { DIRECTIONS, idsOf, MAX_DISTANCE, stepInto };
