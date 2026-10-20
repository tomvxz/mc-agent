// Field bench: measure the skills in the REAL world, not in the arena.
// Usage: node --env-file=../.env bot.js field [locations=30] [seed=1] [only=index]
//
// The bot is sent to random natural locations (always the same ones for a given seed) and does
// the same simple tasks at each: place a block, walk 20-40 blocks, gather 3 logs, explore.
// The report gives the success rate and, above all, WHY the failures happened: we fix the most
// frequent cause first, then run the same seed again to compare. Hand-made arena cases only
// test what we thought of; this bench finds what we did not think of.
// Everything goes through execute() with source "test:field" (dev data, never for training).

import { runCommand } from "../../src/commands.js";
import execute from "../../src/execute.js";
import { sleep, waitUntil } from "../../src/skills/utils.js";
import { drawLocations, summarize } from "./plan.js";

const NOTHING = ["air", "cave_air", "void_air", "short_grass", "tall_grass", "fern", "large_fern"];
const LIQUIDS = ["water", "lava"];
const at = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z));

// A place where the bot can stand in column (x, z): solid ground, 2 free blocks above, no liquid.
// Searched from 20 blocks above the bot down to 20 below. null if none (or not loaded).
function standingSpot(bot, x, z) {
    const top = Math.floor(bot.entity.position.y) + 20;
    for (let y = top; y > top - 40; y--) {
        const ground = at(bot, x, y - 1, z);
        const feet = at(bot, x, y, z);
        const head = at(bot, x, y + 1, z);
        if (!ground || !feet || !head) return null; // not loaded
        if (LIQUIDS.includes(feet.name) || LIQUIDS.includes(ground.name)) return null;
        if (
            ground.boundingBox === "block" &&
            NOTHING.includes(feet.name) &&
            NOTHING.includes(head.name)
        )
            return [x, y, z];
    }
    return null;
}

// The nearest log of any wood type (biomes have different trees)
function nearestLogType(bot) {
    const logs = Object.values(bot.registry.blocksByName).filter(
        (b) => b.name.endsWith("_log") && !b.name.startsWith("stripped"),
    );
    let best = null;
    for (const log of logs) {
        const found = bot.findBlock({ matching: log.id, maxDistance: 32 });
        if (!found) continue;
        const d = found.position.distanceTo(bot.entity.position);
        if (!best || d < best.distance) best = { name: log.name, distance: d };
    }
    return best && best.name;
}

// A free cell next to the ground 2 to 4 blocks from the bot, to place a block on
function placeSpot(bot) {
    const p = bot.entity.position.floored();
    for (const [dx, dz] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
        [2, 2],
        [-2, -2],
        [4, 1],
        [-1, 4],
    ]) {
        const spot = standingSpot(bot, p.x + dx, p.z + dz);
        if (spot) return spot;
    }
    return null;
}

// The tasks done at every location: each returns the skill call, or null if not applicable here
const TASKS = [
    {
        name: "place_block",
        args: (bot) => {
            const s = placeSpot(bot);
            return s && { item: "dirt", x: s[0], y: s[1], z: s[2] };
        },
    },
    {
        name: "move_to",
        args: (bot, loc) => {
            const p = bot.entity.position;
            const x = Math.floor(p.x + Math.cos(loc.moveAngle) * loc.moveDistance);
            const z = Math.floor(p.z + Math.sin(loc.moveAngle) * loc.moveDistance);
            const s = standingSpot(bot, x, z);
            return s && { x: s[0], y: s[1], z: s[2] };
        },
    },
    {
        name: "mine",
        args: (bot) => {
            const log = nearestLogType(bot);
            return log && { block: log, count: 3 };
        },
    },
    { name: "explore", args: (bot, loc) => ({ direction: loc.exploreDirection, distance: 32 }) },
];

// Send the bot to a location, clean (empty inventory except 16 dirt, day, clear weather)
async function goToLocation(bot, loc) {
    const before = bot.entity.position.clone();
    await runCommand(bot, `/spreadplayers ${loc.x} ${loc.z} 0 1 false ${bot.username}`, 5000);
    const moved = await waitUntil(() => bot.entity.position.distanceTo(before) > 10, 10000);
    if (!moved) return false;
    await Promise.race([bot.waitForChunksToLoad(), sleep(15000)]);
    await runCommand(bot, `/clear ${bot.username}`);
    await runCommand(bot, `/give ${bot.username} dirt 16`);
    await runCommand(bot, "/time set day");
    await runCommand(bot, "/weather clear");
    await sleep(2000); // let the terrain and the server settle
    return true;
}

async function runField(bot, n, seed, only) {
    const locations = drawLocations(seed, n).filter((l) => only === null || l.index === only);
    console.log(`\n=== Field bench: ${locations.length} location(s), seed ${seed} ===`);
    const trials = [];

    // Count the server's position corrections during each skill (see "correction" in src/trace.js)
    let corrections = 0;
    bot.on("forcedMove", () => corrections++);

    for (const loc of locations) {
        if (!(await goToLocation(bot, loc))) {
            console.log(`[${loc.index}] (${loc.x}, ${loc.z}): could not get there, skipped`);
            continue;
        }
        const p = bot.entity.position;
        const ground = at(bot, Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z));
        console.log(
            `[${loc.index}] (${loc.x}, ${loc.z}) on ${ground ? ground.name : "?"}, y=${Math.floor(p.y)}`,
        );

        for (const task of TASKS) {
            const args = task.args(bot, loc);
            if (!args) {
                trials.push({ location: loc.index, task: task.name, applicable: false });
                console.log(`    ${task.name}: not applicable here`);
                continue;
            }
            corrections = 0;
            const r = await execute(bot, task.name, args, "test:field");
            trials.push({
                location: loc.index,
                task: task.name,
                applicable: true,
                success: r.success,
                reason: r.reason,
                duration: r.duration,
                corrections,
            });
            const warn =
                r.duration > 0 && corrections / r.duration > 5
                    ? ` ⚠ ${corrections} server corrections`
                    : "";
            console.log(
                `    ${task.name}(${JSON.stringify(args)}): ${r.success ? "OK" : "FAILED " + r.reason} ${r.duration}s${warn}`,
            );
        }
    }

    console.log("\n=== Summary (per task) ===");
    for (const [task, s] of Object.entries(summarize(trials))) {
        const reasons = Object.entries(s.reasons)
            .sort((a, b) => b[1] - a[1])
            .map(([r, k]) => `${r} ${k}`)
            .join(", ");
        console.log(
            `  ${task}: ${s.succeeded}/${s.tried} (${s.rate} %), median ${s.median_duration}s, ` +
                `not applicable ${s.not_applicable}, with many corrections ${s.with_corrections}` +
                (reasons ? ` | failures: ${reasons}` : ""),
        );
    }
    return trials;
}

export default (bot, n, seed, only) =>
    runField(
        bot,
        parseInt(n || "30", 10),
        parseInt(seed || "1", 10),
        only === undefined ? null : parseInt(only, 10),
    );
