import { CENTER as C, giveAndWait, placeAndWait } from "./arena.js";

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

const edgeCases = [
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
