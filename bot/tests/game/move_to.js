import { waitUntil } from "../../src/skills/utils.js";
import { isHostile } from "../../src/state.js";
import { buildOak, CENTER as C, giveAndWait, MAX, MIN, placeAndWait, runCommand } from "./arena.js";

// A wall across the whole arena at z = C.z + 5, from y to y + h - 1
const wall = (bot, material, h = 11) =>
    placeAndWait(
        bot,
        `/fill ${MIN.x + 1} ${C.y} ${C.z + 5} ${MAX.x - 1} ${C.y + h - 1} ${C.z + 5} ${material}`,
        [C.x, C.y + h - 1, C.z + 5],
        material,
    );

const blockAt = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z));

// The check does not take the skill's word for it: it measures the real distance
const arrivedAt =
    (target, range = 2) => // the skill's default range
    (r, before, after, bot) => {
        const d = bot.entity.position.distanceTo(bot.entity.position.clone().set(...target));
        return d <= range + 1 || `real distance ${d.toFixed(1)}`;
    };

// Several checks in a row: the first one that fails gives its message
const all =
    (...checks) =>
    async (...a) => {
        for (const check of checks) {
            const res = await check(...a);
            if (res !== true) return res;
        }
        return true;
    };
const fullHealth = (r, before, after, bot) => bot.health >= 20 || `health ${bot.health}`;

const TARGET = [C.x, C.y, C.z + 10]; // on the other side of the obstacle (z = C.z + 5)
const toTarget = { x: TARGET[0], y: TARGET[1], z: TARGET[2] };

// Targets on flat ground
const nominal = [
    [10, 0],
    [-10, -10],
    [15, 15],
    [-20, 20],
    [0, -20],
].map(([dx, dz]) => {
    const target = [C.x + dx, C.y, C.z + dz];
    return {
        name: `flat ${dx},${dz}`,
        args: { x: target[0], y: target[1], z: target[2] },
        verify: arrivedAt(target),
    };
});

// Distance tracking to the husk (the "avoid a monster" case)
let tracking = null;

nominal.push(
    {
        name: "go around the corner of a wall",
        setup: (bot) =>
            placeAndWait(
                bot,
                `/fill ${C.x - 5} ${C.y} ${C.z + 5} ${C.x + 5} ${C.y + 3} ${C.z + 5} barrier`,
                [C.x + 5, C.y + 3, C.z + 5],
                "barrier",
            ),
        args: toTarget,
        verify: arrivedAt(TARGET),
    },
    {
        name: "reflex: jump over a lava trench (2 wide, full width)",
        setup: (bot) =>
            placeAndWait(
                bot,
                `/fill ${MIN.x + 1} ${C.y - 1} ${C.z + 4} ${MAX.x - 1} ${C.y - 1} ${C.z + 5} lava`,
                [C.x, C.y - 1, C.z + 5],
                "lava",
            ),
        args: toTarget,
        verify: all(arrivedAt(TARGET), fullHealth),
    },
    {
        name: "reflex: go around a lava strip (3 wide)",
        setup: (bot) =>
            placeAndWait(
                bot,
                `/fill ${C.x - 10} ${C.y - 1} ${C.z + 4} ${C.x + 10} ${C.y - 1} ${C.z + 6} lava`,
                [C.x, C.y - 1, C.z + 6],
                "lava",
            ),
        args: toTarget,
        verify: all(arrivedAt(TARGET), fullHealth),
    },
    {
        name: "reflex: climb onto a 3-block plateau (dirt given)",
        setup: async (bot) => {
            await giveAndWait(bot, "dirt", 8);
            await placeAndWait(
                bot,
                `/fill ${C.x + 5} ${C.y} ${C.z - 5} ${C.x + 12} ${C.y + 2} ${C.z + 5} stone`,
                [C.x + 12, C.y + 2, C.z + 5],
                "stone",
            );
        },
        args: { x: C.x + 8, y: C.y + 3, z: C.z },
        verify: all(
            arrivedAt([C.x + 8, C.y + 3, C.z]),
            (r) =>
                r.details.blocks_placed + r.details.blocks_broken > 0 ||
                "no block placed or broken: how did it get up?",
        ),
    },
    {
        name: "reflex: dig through a stone wall that closes everything",
        setup: (bot) => wall(bot, "stone"),
        args: toTarget,
        verify: all(arrivedAt(TARGET), (r) => r.details.blocks_broken > 0 || "no block broken"),
    },
    {
        name: "reflex: walk over a chest without breaking it",
        setup: async (bot) => {
            await wall(bot, "barrier", 3);
            await runCommand(bot, `/setblock ${C.x} ${C.y + 1} ${C.z + 5} air`);
            await runCommand(bot, `/setblock ${C.x} ${C.y + 2} ${C.z + 5} air`);
            await placeAndWait(
                bot,
                `/setblock ${C.x} ${C.y} ${C.z + 5} chest`,
                [C.x, C.y, C.z + 5],
                "chest",
            );
        },
        args: toTarget,
        verify: all(
            arrivedAt(TARGET),
            (r, a, b, bot) => blockAt(bot, C.x, C.y, C.z + 5).name === "chest" || "chest broken",
        ),
    },
    {
        name: "instinct: keep away from a husk on the straight line",
        setup: async (bot) => {
            await runCommand(bot, `/summon husk ${C.x + 0.5} ${C.y} ${C.z + 5.5} {NoAI:1b}`);
            if (!(await waitUntil(() => Object.values(bot.entities).some((e) => isHostile(bot, e)), 3000))) {
                throw new Error("monster invisible to the bot");
            }
            // Record the minimum distance to the husk during the whole trip
            if (tracking) clearInterval(tracking.timer);
            tracking = { min: Infinity };
            tracking.timer = setInterval(() => {
                const h = Object.values(bot.entities).find((e) => isHostile(bot, e));
                if (h)
                    tracking.min = Math.min(
                        tracking.min,
                        h.position.distanceTo(bot.entity.position),
                    );
            }, 100);
            setTimeout(() => clearInterval(tracking.timer), 60000);
        },
        args: toTarget,
        verify: all(arrivedAt(TARGET), () => {
            clearInterval(tracking.timer);
            return tracking.min >= 3 || `passed ${tracking.min.toFixed(1)} blocks from the husk`;
        }),
    },
);

// Next to a tree (the default range, 2), through its leaves: the target is the log itself
nominal.push({
    name: "next to a built oak (default range)",
    setup: (bot) => buildOak(bot, 7, 7),
    args: { x: C.x + 7, y: C.y, z: C.z + 7 },
    verify: arrivedAt([C.x + 7, C.y, C.z + 7], 2),
});

const edgeCases = [
    {
        name: "target enclosed in barrier (unbreakable)",
        setup: (bot) =>
            placeAndWait(
                bot,
                `/fill ${C.x + 9} ${C.y - 1} ${C.z - 11} ${C.x + 11} ${C.y + 2} ${C.z - 9} barrier hollow`,
                [C.x + 11, C.y + 2, C.z - 9],
                "barrier",
            ),
        // range 1: the exact spot is unreachable (with the default range 2, standing outside the
        // enclosure is close enough, and that is a success)
        args: { x: C.x + 10, y: C.y, z: C.z - 10, range: 1 },
        expect: "no_path",
    },
    {
        name: "closed fence gate in an unbreakable wall: no automatic opening (batch 2: use_item)",
        setup: async (bot) => {
            await wall(bot, "barrier");
            await placeAndWait(
                bot,
                `/setblock ${C.x} ${C.y} ${C.z + 5} oak_fence_gate[facing=south]`,
                [C.x, C.y, C.z + 5],
                "oak_fence_gate",
            );
            await runCommand(bot, `/setblock ${C.x} ${C.y + 1} ${C.z + 5} air`); // room for the head
        },
        args: toTarget,
        expect: "no_path",
    },
    {
        name: "target inside a log with range 1: target_blocked at once",
        setup: (bot) => buildOak(bot, 7, 7),
        args: { x: C.x + 7, y: C.y, z: C.z + 7, range: 1 },
        expect: "target_blocked",
    },
    { name: "invalid arguments", args: { x: "far" }, expect: "invalid_args" },
];

export const skill = "move_to";
export { edgeCases, nominal };
