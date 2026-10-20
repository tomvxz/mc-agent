import { buildOak, CENTER as C, growOak, placeAndWait } from "./arena.js";

// Place a column of logs of height h (wait until the bot sees the top one)
const column = (bot, dx, dz, h) =>
    placeAndWait(
        bot,
        `/fill ${C.x + dx} ${C.y} ${C.z + dz} ${C.x + dx} ${C.y + h - 1} ${C.z + dz} oak_log`,
        [C.x + dx, C.y + h - 1, C.z + dz],
        "oak_log",
    );

// Check in the real inventory that at least 2 logs were gained
const gainedTwo = (r, before, after) => {
    const delta = (after.inventory.oak_log || 0) - (before.inventory.oak_log || 0);
    return delta >= 2 || `oak_log +${delta}`;
};

// Different "forests": [dx, dz, height]
const FORESTS = [
    [[3, 0, 2]],
    [
        [-6, 4, 1],
        [-6, 6, 1],
    ],
    [[8, -8, 3]],
    [[0, 12, 5]],
    [[-10, -3, 4]],
    [
        [5, 5, 1],
        [-5, -5, 1],
    ],
];

const nominal = FORESTS.map((forest) => ({
    name: `forest ${JSON.stringify(forest)}`,
    setup: async (bot) => {
        for (const [dx, dz, h] of forest) await column(bot, dx, dz, h);
    },
    args: { block: "oak_log", count: 2 },
    verify: gainedTwo,
}));

// The nearest log is enclosed (unreachable): mine must move on to the next one
nominal.push({
    name: "the nearest is enclosed, another one is reachable",
    setup: async (bot) => {
        await placeAndWait(
            bot,
            `/fill ${C.x + 2} ${C.y - 1} ${C.z - 1} ${C.x + 4} ${C.y + 1} ${C.z + 1} barrier hollow`,
            [C.x + 4, C.y + 1, C.z + 1],
            "barrier",
        );
        await placeAndWait(
            bot,
            `/setblock ${C.x + 3} ${C.y} ${C.z} oak_log`,
            [C.x + 3, C.y, C.z],
            "oak_log",
        );
        await column(bot, -10, 6, 2);
    },
    args: { block: "oak_log", count: 2 },
    verify: gainedTwo,
});

// Real trees, with leaves (the case that failed with the LLM): 3 logs each time
const gainedThree = (r, before, after) => {
    const delta = (after.inventory.oak_log || 0) - (before.inventory.oak_log || 0);
    return delta >= 3 || `oak_log +${delta}`;
};
nominal.push(
    {
        name: "built oak with leaves",
        setup: (bot) => buildOak(bot, 6, 0),
        args: { block: "oak_log", count: 3 },
        verify: gainedThree,
    },
    {
        name: "two built oaks",
        setup: async (bot) => {
            await buildOak(bot, -7, 4);
            await buildOak(bot, 8, -8);
        },
        args: { block: "oak_log", count: 3 },
        verify: gainedThree,
    },
    {
        name: "oak grown by the game",
        setup: (bot) => growOak(bot, -6, -6),
        args: { block: "oak_log", count: 3 },
        verify: gainedThree,
    },
    {
        name: "oak grown by the game (2)",
        setup: (bot) => growOak(bot, 9, 4),
        args: { block: "oak_log", count: 3 },
        verify: gainedThree,
    },
    {
        name: "oak grown by the game (3)",
        setup: (bot) => growOak(bot, -3, 11),
        args: { block: "oak_log", count: 3 },
        verify: gainedThree,
    },
);

const edgeCases = [
    { name: "no log", args: { block: "oak_log", count: 1 }, expect: "block_not_found" },
    {
        name: "a single log for 2 requested",
        setup: async (bot) => column(bot, 3, 0, 1),
        args: { block: "oak_log", count: 2 },
        expect: "partial",
    },
    { name: "invalid count", args: { block: "oak_log", count: 0 }, expect: "invalid_args" },
    {
        name: "stone without a pickaxe",
        setup: (bot) =>
            placeAndWait(
                bot,
                `/setblock ${C.x + 3} ${C.y} ${C.z} stone`,
                [C.x + 3, C.y, C.z],
                "stone",
            ),
        args: { block: "stone", count: 1 },
        expect: "no_tool",
    },
];

export const skill = "mine";
export { edgeCases, nominal };
