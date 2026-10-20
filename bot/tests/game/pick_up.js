import { waitUntil } from "../../src/skills/utils.js";
import { CENTER as C, runCommand } from "./arena.js";

// Drop `count` items of `name` at (dx, dy, dz) from the center, and wait until the bot sees them
async function dropItem(bot, name, count, [dx, dy, dz]) {
    const [x, y, z] = [C.x + dx + 0.5, C.y + dy, C.z + dz + 0.5];
    await runCommand(
        bot,
        `/summon item ${x} ${y} ${z} {Item:{id:"minecraft:${name}",count:${count}}}`,
    );
    const seen = await waitUntil(
        () =>
            Object.values(bot.entities).some(
                (e) =>
                    e.name === "item" &&
                    e.position.distanceTo(bot.entity.position.clone().set(x, y, z)) < 1.5,
            ),
        3000,
    );
    if (!seen) throw new Error(`the bot does not see the dropped ${name}`); // setup failed
}

// Check in the real inventory that the items were gained
const gained = (item, n) => (r, before, after) => {
    const delta = (after.inventory[item] || 0) - (before.inventory[item] || 0);
    return delta >= n || `${item} +${delta}`;
};

const nominal = [
    {
        name: "one stack 5 blocks away",
        setup: (bot) => dropItem(bot, "oak_log", 3, [5, 0, 0]),
        args: {},
        verify: gained("oak_log", 3),
    },
    {
        name: "two items in different places, only oak_log asked for",
        setup: async (bot) => {
            await dropItem(bot, "oak_log", 2, [-4, 0, 3]);
            await dropItem(bot, "dirt", 1, [3, 0, -4]);
        },
        args: { item: "oak_log" },
        verify: gained("oak_log", 2),
    },
    {
        name: "an item on a 1-block step",
        setup: async (bot) => {
            await runCommand(bot, `/setblock ${C.x + 4} ${C.y} ${C.z + 4} stone`);
            await dropItem(bot, "stick", 4, [4, 1, 4]);
        },
        args: { item: "stick" },
        verify: gained("stick", 4),
    },
];

const edgeCases = [
    { name: "nothing on the ground", args: {}, expect: "nothing_to_pick_up" },
    {
        name: "unknown item",
        args: { item: "no_such_item" },
        expect: "unknown_item",
    },
    {
        name: "an item further than max_distance",
        setup: (bot) => dropItem(bot, "oak_log", 1, [12, 0, 0]),
        args: { max_distance: 8 },
        expect: "nothing_to_pick_up",
    },
];

export const skill = "pick_up";
export { edgeCases, nominal };
