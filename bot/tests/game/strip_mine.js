import { CENTER as C, placeAndWait } from "./arena.js";
import { stoneMass } from "./dig.js";

// Ores in the walls of the future tunnel (east of the bot, at its feet and head level): an iron ore at the
// 3rd block with a second one behind it (a vein: hidden until the first is mined), a coal ore at the 6th
async function oresInWalls(bot, pickaxe = "stone_pickaxe") {
    await stoneMass(bot, 4, pickaxe);
    const ores = [
        [C.x + 3, C.y + 1, C.z + 1, "iron_ore"],
        [C.x + 3, C.y + 1, C.z + 2, "iron_ore"],
        [C.x + 6, C.y, C.z - 1, "coal_ore"],
    ];
    for (const [x, y, z, ore] of ores) await placeAndWait(bot, `/setblock ${x} ${y} ${z} ${ore}`, [x, y, z], ore);
}

const gained = (item, n) => (r) => (r.details.collected[item] || 0) >= n || `${item}: ${r.details.collected[item] || 0}`;

const nominal = [
    {
        name: "collects every ore of the list on the way, the vein too",
        setup: (bot) => oresInWalls(bot),
        args: { direction: "east", blocks: ["#iron_ores", "#coal_ores"], max_distance: 8 },
        verify: (r) =>
            (gained("raw_iron", 2)(r) === true && gained("coal", 1)(r) === true && r.details.stopped_by === "distance") ||
            JSON.stringify(r.details.collected),
    },
    {
        name: "stops as soon as the inventory has `until`",
        setup: (bot) => oresInWalls(bot),
        args: { direction: "east", blocks: ["#iron_ores", "#coal_ores"], until: { raw_iron: 1 }, max_distance: 8 },
        verify: (r) => (r.details.stopped_by === "until" && r.details.dug < 6) || `${r.details.stopped_by}, dug ${r.details.dug}`,
    },
    {
        name: "stops at the end of max_seconds (a normal end)",
        setup: (bot) => oresInWalls(bot),
        args: { direction: "east", blocks: ["#copper_ores"], max_seconds: 8, max_distance: 64 }, // none placed
        verify: (r) => r.details.stopped_by === "time" || `stopped_by ${r.details.stopped_by}`,
    },
    {
        // A wooden pickaxe cannot harvest iron: it is left out, the coal is still collected
        name: "a kind it cannot harvest is skipped, the others collected",
        setup: (bot) => oresInWalls(bot, "wooden_pickaxe"),
        args: { direction: "east", blocks: ["#iron_ores", "#coal_ores"], max_distance: 8 },
        verify: (r) => (gained("coal", 1)(r) === true && Array.isArray(r.details.skipped?.iron_ore)) || JSON.stringify(r.details),
    },
];

const edgeCases = [
    {
        name: "no pickaxe: nothing of the list can be harvested",
        setup: (bot) => oresInWalls(bot, null),
        args: { direction: "east", blocks: ["#iron_ores"] },
        expect: "no_tool",
    },
    {
        name: "until diamonds with a stone pickaxe: refused at once",
        setup: (bot) => oresInWalls(bot),
        args: { direction: "east", blocks: ["#diamond_ores", "#iron_ores"], until: { diamond: 1 } },
        expect: "no_tool",
    },
    {
        name: "an until item no block of the list drops",
        args: { direction: "east", blocks: ["#iron_ores"], until: { diamond: 1 } },
        expect: "invalid_args",
    },
];

export const skill = "strip_mine";
export { edgeCases, nominal };
