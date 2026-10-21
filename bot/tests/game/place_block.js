import { CENTER as C, giveAndWait, placeAndWait } from "./arena.js";

// A block in the cell where the bot will place (plants need a grass block below, the floor is stone).
// It checks the game's rule for minecraft:replaceable (src/tags.js) in the real game.
const putInCell = (dx, dz, block, name = block) => async (bot) => {
    await giveCobblestone(bot);
    const [x, z] = [C.x + dx, C.z + dz];
    await placeAndWait(bot, `/setblock ${x} ${C.y - 1} ${z} grass_block`, [x, C.y - 1, z], "grass_block");
    await placeAndWait(bot, `/setblock ${x} ${C.y} ${z} ${block}`, [x, C.y, z], name);
};

const giveCobblestone = (bot) => giveAndWait(bot, "cobblestone", 5);

// Check in the real world that the block is placed
const isPlaced = (x, y, z) => (r, before, after, bot) => {
    const b = bot.blockAt(bot.entity.position.clone().set(x, y, z));
    return (b && b.name === "cobblestone") || `block found: ${b && b.name}`;
};

// Positions on the floor: next to the bot, then further and further (it has to walk)
const POSITIONS = [
    [1, 0],
    [0, -2],
    [-6, 3],
    [8, 8],
    [-12, -4],
    [15, -10],
];

const nominal = POSITIONS.map(([dx, dz]) => {
    const [x, y, z] = [C.x + dx, C.y, C.z + dz];
    return {
        name: `floor ${dx},${dz}`,
        setup: giveCobblestone,
        args: { item: "cobblestone", x, y, z },
        verify: isPlaced(x, y, z),
    };
});

// On top of an existing block (supported from below, at eye level)
nominal.push({
    name: "on top of a block",
    setup: async (bot) => {
        await giveCobblestone(bot);
        await placeAndWait(
            bot,
            `/setblock ${C.x + 4} ${C.y} ${C.z + 4} stone`,
            [C.x + 4, C.y, C.z + 4],
            "stone",
        );
    },
    args: { item: "cobblestone", x: C.x + 4, y: C.y + 1, z: C.z + 4 },
    verify: isPlaced(C.x + 4, C.y + 1, C.z + 4),
});

// What a player can place onto: the game replaces grass and ONE layer of snow
for (const [dx, dz, block, name] of [
    [3, 2, "short_grass", "short_grass"],
    [-3, 2, "snow[layers=1]", "snow"],
]) {
    nominal.push({
        name: `onto ${block}`,
        setup: putInCell(dx, dz, block, name),
        args: { item: "cobblestone", x: C.x + dx, y: C.y, z: C.z + dz },
        verify: isPlaced(C.x + dx, C.y, C.z + dz),
    });
}

const edgeCases = [
    {
        name: "a flower is not replaced",
        setup: putInCell(-3, -3, "poppy"),
        args: { item: "cobblestone", x: C.x - 3, y: C.y, z: C.z - 3 },
        expect: "occupied",
    },
    {
        name: "deep snow is not replaced (in the tag, but only one layer is: it has a collision box)",
        setup: putInCell(3, -3, "snow[layers=3]", "snow"),
        args: { item: "cobblestone", x: C.x + 3, y: C.y, z: C.z - 3 },
        expect: "occupied",
    },
    {
        name: "occupied cell",
        setup: async (bot) => {
            await giveCobblestone(bot);
            await placeAndWait(
                bot,
                `/setblock ${C.x + 3} ${C.y} ${C.z} stone`,
                [C.x + 3, C.y, C.z],
                "stone",
            );
        },
        args: { item: "cobblestone", x: C.x + 3, y: C.y, z: C.z },
        expect: "occupied",
    },
    {
        name: "not in the inventory",
        args: { item: "cobblestone", x: C.x + 3, y: C.y, z: C.z },
        expect: "not_in_inventory",
    },
    {
        name: "in mid-air, no support",
        setup: giveCobblestone,
        args: { item: "cobblestone", x: C.x + 3, y: C.y + 4, z: C.z },
        expect: "no_support",
    },
];

export const skill = "place_block";
export { edgeCases, nominal };
