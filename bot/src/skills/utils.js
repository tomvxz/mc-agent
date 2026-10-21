// Small helpers shared by several skills (this is not a skill)
import mineflayerPathfinder from "mineflayer-pathfinder";
import { refuseIfCancelled } from "../cancel.js";
import { MAX_DROP_DOWN, SCAFFOLDING_BLOCKS } from "../movements.js";
const { goals } = mineflayerPathfinder;

// Wait ms milliseconds, in steps of at most 50 ms. In a skill stopped by its time limit, throws at
// the next step (see cancel.js): the stopped skill ends within 50 ms instead of going on until its
// next action. Outside a skill (tests, arena setup), it is a plain wait.
async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        refuseIfCancelled();
        await new Promise((r) => setTimeout(r, Math.min(50, end - Date.now())));
    }
    refuseIfCancelled();
}

// Wait until condition() becomes true, at most maxMs. Returns true if it happened.
// (Uses sleep: it also stops a skill that was stopped.)
async function waitUntil(condition, maxMs) {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
        if (condition()) return true;
        await sleep(50);
    }
    return condition();
}

// Turn a pathfinder error into a readable failure reason
function movementFailureReason(e) {
    if (e.name === "Stuck") return "stuck";
    if (e.name === "NoPath") return "no_path";
    if (e.name === "Timeout") return "path_timeout"; // it thought for too long
    if (e.name === "GoalChanged" || e.name === "PathStopped")
        return "interrupted";
    return "exception";
}

// pathfinder.goto with a stuck detector: if the bot does not move (half a block horizontally, or a
// real climb) for STUCK_MS while not digging or pillaring, give up with an error named "Stuck" (reason "stuck") instead of
// waiting for the skill's 60 s time limit. Seen in game: the bot jumped for 35 s in a hole it had
// dug, unable to get out under low leaves.
const STUCK_MS = 8000;
async function gotoWatched(bot, goal, stuckMs = STUCK_MS) {
    let last = bot.entity.position.clone();
    let lastProgress = Date.now();
    let stuck = false;
    const timer = setInterval(() => {
        try {
            const busy =
                bot.targetDigBlock ||
                (bot.pathfinder.isMining && bot.pathfinder.isMining()) ||
                (bot.pathfinder.isBuilding && bot.pathfinder.isBuilding()); // digging or pillaring is progress
            const p = bot.entity.position;
            // Jumping in place is NOT progress (seen in game: the bot jumped for 35 s in a hole and each
            // jump moved it by more than half a block): count only horizontal moves or real climbs
            const moved =
                Math.hypot(p.x - last.x, p.z - last.z) > 0.5 ||
                Math.abs(p.y - last.y) > 1.5;
            if (busy || moved) {
                last = bot.entity.position.clone();
                lastProgress = Date.now();
            } else if (Date.now() - lastProgress > stuckMs && !stuck) {
                stuck = true;
                bot.pathfinder.setGoal(null); // makes goto reject
            }
        } catch (e) {
            clearInterval(timer); // e.g. the skill was cancelled: never let an error escape a timer
        }
    }, 250);
    try {
        await bot.pathfinder.goto(goal);
    } catch (e) {
        if (stuck) {
            const err = new Error(`no progress for ${stuckMs / 1000} s`);
            err.name = "Stuck";
            throw err;
        }
        throw e;
    } finally {
        clearInterval(timer);
    }
}

// Estimated walking time (s) to a position, for skill budgets (runSkill.js): straight distance x 1.5
// (paths are not straight) at walking speed, + 2 s to compute the path. Only a rough estimate: the
// skill is stopped at 3x it.
const WALK_SPEED = 4.3; // blocks per second, the game's walking speed
function walkSeconds(bot, x, y, z) {
    const d = bot.entity.position.distanceTo(makeVec3(bot, x, y, z));
    return (1.5 * d) / WALK_SPEED + 2;
}

// walk moves without the pathfinder: the same instincts are checked here.
// What is one step ahead in direction (dx, dz) (any length): null if safe, otherwise
// { danger: "lava" | "drop" | "water" | "unloaded", ... }. "drop": no ground within MAX_DROP_DOWN below.
function dangerAhead(bot, dx, dz) {
    const n = Math.hypot(dx, dz);
    if (n === 0) return null;
    const p = bot.entity.position;
    const x = Math.floor(p.x + (dx / n) * 0.8);
    const z = Math.floor(p.z + (dz / n) * 0.8);
    const y = Math.floor(p.y);
    for (let dy = 1; dy >= -(MAX_DROP_DOWN + 1); dy--) {
        const b = bot.blockAt(makeVec3(bot, x, y + dy, z));
        if (!b) return { danger: "unloaded" };
        if (b.name === "lava" || b.name === "fire") return { danger: "lava", block: b.name, position: [x, y + dy, z] };
        if (dy > 0) continue; // head level: only lava matters here
        if (b.name === "water") return { danger: "water", position: [x, y + dy, z] };
        if (dy < 0 && b.boundingBox === "block") return null; // ground within reach
        if (dy === 0 && b.boundingBox === "block") return null; // a step up, not a fall
    }
    return { danger: "drop", position: [x, y, z], min_depth: MAX_DROP_DOWN + 1 };
}

// The horizontal direction (dx, dz) Mineflayer's yaw faces (yaw 0 = north, -z; pi/2 = west)
const facing = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

// Build a Vec3 (Mineflayer's 3D vector) by copying the bot's position and changing x, y, z
function makeVec3(bot, x, y, z) {
    return bot.entity.position.clone().set(x, y, z);
}

// Round to one decimal, for readable details
const round1 = (v) => Math.round(v * 10) / 10;

// Inventory as { name: count }
function inventoryCounts(bot) {
    const inv = {};
    for (const i of bot.inventory.items())
        inv[i.name] = (inv[i.name] || 0) + i.count;
    return inv;
}

// What was gained since `before` (only counts that went up): { oak_log: 2 }
function gainedSince(bot, before) {
    const gains = {};
    for (const [name, n] of Object.entries(inventoryCounts(bot))) {
        if (n > (before[name] || 0)) gains[name] = n - (before[name] || 0);
    }
    return gains;
}

// Count the blocks placed and broken by the bot during a move
// (the pathfinder pillars up, bridges and digs passages on its own).
// Placed = scaffolding blocks consumed from the inventory (while moving, only the
// pathfinder places any; Mineflayer's blockPlaced event is not always emitted).
function trackWorldChanges(bot) {
    const scaffolding = () =>
        SCAFFOLDING_BLOCKS.reduce(
            (n, name) => n + (inventoryCounts(bot)[name] || 0),
            0,
        );
    const before = scaffolding();
    let broken = 0;
    const onBroken = () => broken++;
    bot.on("diggingCompleted", onBroken);
    return () => {
        bot.removeListener("diggingCompleted", onBroken);
        return {
            blocks_placed: Math.max(0, before - scaffolding()),
            blocks_broken: broken,
        };
    };
}

// Items lying on the ground (item entities) within maxDistance of `center`, nearest first
function itemsOnGround(bot, center, maxDistance) {
    return Object.values(bot.entities)
        .filter(
            (e) =>
                e.name === "item" &&
                e.position &&
                e.position.distanceTo(center) <= maxDistance,
        )
        .sort(
            (a, b) =>
                a.position.distanceTo(center) - b.position.distanceTo(center),
        );
}

// The item of an item entity: { name, count }, or null if unknown
function droppedItem(entity) {
    try {
        const item = entity.getDroppedItem && entity.getDroppedItem();
        return item ? { name: item.name, count: item.count } : null;
    } catch (e) {
        return null;
    }
}

// After a block is broken: what fell on the ground near it (the items appear shortly after the
// block breaks). An item that lands right next to the bot may be picked up at once by the game:
// it is then in the inventory, not in this list.
async function dropsNear(bot, p, waitMs = 1000) {
    const center = p.offset(0.5, 0.5, 0.5);
    const appeared = await waitUntil(
        () => itemsOnGround(bot, center, 3).length > 0,
        waitMs,
    );
    if (appeared) await sleep(300); // several items may drop (e.g. ores): wait for all of them
    return itemsOnGround(bot, center, 3).map((e) => ({
        ...(droppedItem(e) || { name: null, count: null }),
        position: [
            round1(e.position.x),
            round1(e.position.y),
            round1(e.position.z),
        ],
    }));
}

// Where an item will lie: on top of the first solid block below it (leaves included). A fresh drop
// appears where the block was and falls for about a second, and the server sends the position of
// an item only about once per second: aiming at where it is now can be 3 blocks too high.
function landingSpot(bot, p) {
    for (let y = Math.floor(p.y); y > Math.floor(p.y) - 16; y--) {
        const below = bot.blockAt(p.clone().set(Math.floor(p.x), y, Math.floor(p.z)));
        if (below && below.boundingBox === "block") return p.clone().set(p.x, y + 1, p.z);
    }
    return p.clone();
}

// Walk onto an item lying on the ground until the game picks it up. Returns true if picked up.
// Throws the movement error if the item cannot be reached.
// The target can MOVE (seen: the bot kept aiming at a log's old position, 3 blocks up, while the
// drop fell, and gave up): aim at where it lands, and aim again once if it moved during the walk.
async function walkOnto(bot, entity) {
    const pickedUp = () => !bot.entities[entity.id]; // picked up = the entity disappears
    for (let attempt = 0; attempt < 2; attempt++) {
        if (pickedUp()) return true; // e.g. on the way to the previous item
        // Get within 1 block (pickup works at that distance; aiming for 0 makes the pathfinder
        // break the blocks above to stand there)
        const o = landingSpot(bot, entity.position);
        const moved = () => pickedUp() || landingSpot(bot, entity.position).distanceTo(o) > 1;
        try {
            await gotoWatched(bot, new goals.GoalNear(o.x, o.y, o.z, 1));
        } catch (e) {
            if (attempt === 0 && moved()) continue; // it moved: aim again
            throw e;
        }
        if (await waitUntil(pickedUp, 700)) return true; // 700 ms: a fresh item cannot be picked up for 0.5 s
        if (!moved()) break; // it did not move: walking again would not help
    }
    if (pickedUp()) return true;
    // Still there: look at it and walk straight towards it (at most 1 s)
    await bot.lookAt(entity.position, true);
    bot.setControlState("forward", true);
    const ok = await waitUntil(pickedUp, 1000);
    bot.setControlState("forward", false);
    return ok;
}

export {
    dangerAhead,
    droppedItem,
    facing,
    dropsNear,
    gainedSince,
    gotoWatched,
    inventoryCounts,
    itemsOnGround,
    makeVec3,
    movementFailureReason,
    round1,
    sleep,
    trackWorldChanges,
    waitUntil,
    landingSpot,
    walkOnto,
    walkSeconds,
    WALK_SPEED,
};
