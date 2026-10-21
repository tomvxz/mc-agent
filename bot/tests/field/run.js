// Field bench: measure the skills in the REAL world, not in the arena.
// Usage: node --env-file=../.env bot.js field [locations=30] [seed=1] [only=index]
//
// The bot is sent to random natural locations (always the same ones for a given seed; one without
// safe ground, e.g. ocean, is replaced by the next draw) and does
// the same simple tasks at each: place a block, walk 20-40 blocks, gather 3 logs, explore.
// The report gives the success rate and, above all, WHY the failures happened: we fix the most
// frequent cause first, then run the same seed again to compare. Hand-made arena cases only
// test what we thought of; this bench finds what we did not think of.
// Everything goes through execute() with source "test:field" (dev data, never for training).

import execute from "../../src/execute.js";
import { setupPlace } from "../../src/setup.js";
import { inBlockTag } from "../../src/tags.js";
import { drawLocations, summarize } from "./plan.js";

const LIQUIDS = ["water", "lava"];
const at = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z));

// A place where the bot can stand in column (x, z): solid ground that is not leaves (a tree top is not
// ground: seen, a place_block cell 17 blocks above the bot), 2 free blocks above (air or what the game
// replaces: grass...), no liquid. Searched from `reach` blocks above the bot down to `reach` below.
// null if none (or not loaded).
function standingSpot(bot, x, z, reach = 20) {
    const top = Math.floor(bot.entity.position.y) + reach;
    for (let y = top; y > top - 2 * reach; y--) {
        const ground = at(bot, x, y - 1, z);
        const feet = at(bot, x, y, z);
        const head = at(bot, x, y + 1, z);
        if (!ground || !feet || !head) return null; // not loaded
        if (LIQUIDS.includes(feet.name) || LIQUIDS.includes(ground.name)) return null;
        if (
            ground.boundingBox === "block" &&
            !inBlockTag(bot, "leaves", ground) &&
            inBlockTag(bot, "replaceable", feet) &&
            inBlockTag(bot, "replaceable", head)
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

// A free cell on the ground 2 to 4 blocks from the bot, at most 2 blocks above or below it, to place a block on
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
        const spot = standingSpot(bot, p.x + dx, p.z + dz, 2);
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

// A location without safe ground (ocean, lava) is replaced by the next one, up to MAX_TRIES * n draws.
// The first draws of a seed do not depend on n: the locations already played stay the same.
const MAX_TRIES = 3;
const MIN_CANDIDATES = 10; // and at least this many draws: about one in two is ocean

// Send the bot to a location, clean (empty inventory except 16 dirt, day, clear weather)
async function goToLocation(bot, loc) {
    return setupPlace(bot, { x: loc.x, z: loc.z, inventory: { dirt: 16 } });
}

async function runField(bot, n, seed, only) {
    const wanted = only === null ? n : 1;
    const candidates =
        only === null
            ? drawLocations(seed, Math.max(MAX_TRIES * n, MIN_CANDIDATES))
            : drawLocations(seed, only + 1).slice(only);
    console.log(`\n=== Field bench: ${wanted} location(s), seed ${seed} ===`);
    const trials = [];
    let played = 0;
    let replaced = 0;

    // Count the server's position corrections during each skill (see "correction" in src/trace.js)
    let corrections = 0;
    bot.on("forcedMove", () => corrections++);

    for (const loc of candidates) {
        if (played === wanted) break;
        const setup = await goToLocation(bot, loc);
        if (!setup.success) {
            replaced++;
            console.log(
                `[${loc.index}] (${loc.x}, ${loc.z}): could not get there, replaced by the next location` +
                    ` (${setup.details.server_answer || setup.reason})`,
            );
            continue;
        }
        played++;
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

    if (played < wanted) console.log(`\nonly ${played} of ${wanted} locations could be set up`);
    console.log(`\n=== Summary (per task), ${played} location(s), ${replaced} replaced ===`);
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
