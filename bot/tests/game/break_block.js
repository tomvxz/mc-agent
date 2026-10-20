import { buildOak, CENTER as C, giveAndWait, placeAndWait } from "./arena.js";

const blockAt = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z));

// break_block only breaks: check that the block is gone (picking up is tested in collect_block.js)
const broken =
    ([x, y, z]) =>
    (r, before, after, bot) => {
        const b = blockAt(bot, x, y, z);
        return !b || b.name === "air" || `the block is still there (${b.name})`;
    };

// collect_block also picks up: check that the block is gone AND that the item reached the inventory
const brokenAndCollected =
    ([x, y, z], item) =>
    (r, before, after, bot) => {
        const gone = broken([x, y, z])(r, before, after, bot);
        if (gone !== true) return gone;
        const delta = (after.inventory[item] || 0) - (before.inventory[item] || 0);
        return delta >= 1 || `${item} +${delta}`;
    };

// [name, position, block placed, expected item, extra setup] (shared with collect_block.js)
const CASES = [
    ["log on the ground", [C.x + 3, C.y, C.z], "oak_log", "oak_log"],
    [
        "log up high (y+3, floating: the item falls to the ground)",
        [C.x - 4, C.y + 3, C.z + 2],
        "oak_log",
        "oak_log",
    ],
    ["dirt", [C.x + 6, C.y, C.z - 6], "dirt", "dirt"],
    ["stone with a pickaxe", [C.x - 8, C.y, C.z - 3], "stone", "cobblestone", "pickaxe"],
];

// The nominal cases, checked with `verify(position, item)`
function nominalCases(verify) {
    const cases = CASES.map(([name, [x, y, z], material, item, extra]) => ({
        name,
        setup: async (bot) => {
            await placeAndWait(bot, `/setblock ${x} ${y} ${z} ${material}`, [x, y, z], material);
            if (extra === "pickaxe") await giveAndWait(bot, "wooden_pickaxe", 1);
        },
        args: { x, y, z },
        verify: verify([x, y, z], item),
    }));
    // Logs of a real tree: the bottom one, and one under the crown (y+3, surrounded by leaves)
    for (const [name, dy] of [
        ["trunk of a built oak, bottom log", 0],
        ["trunk of a built oak, log under the leaves (y+3)", 3],
    ]) {
        cases.push({
            name,
            setup: (bot) => buildOak(bot, 5, 3),
            args: { x: C.x + 5, y: C.y + dy, z: C.z + 3 },
            verify: verify([C.x + 5, C.y + dy, C.z + 3], "oak_log"),
        });
    }
    return cases;
}
const nominal = nominalCases(broken);

const P = [C.x + 3, C.y, C.z];
const H = [C.x - 4, C.y + 3, C.z + 2];
// The item falls back ONTO the column, out of reach: break_block -> ok, collect_block -> not_collected
const topOfColumn = (expect) => ({
    name: "top of a column (item out of reach)",
    setup: (bot) =>
        placeAndWait(
            bot,
            `/fill ${H[0]} ${C.y} ${H[2]} ${H[0]} ${H[1]} ${H[2]} oak_log`,
            H,
            "oak_log",
        ),
    args: { x: H[0], y: H[1], z: H[2] },
    expect,
});
// The failures decided before digging (the same for break_block and collect_block)
const commonEdgeCases = [
    {
        name: "nothing to break (air)",
        args: { x: P[0], y: P[1], z: P[2] },
        expect: "nothing_to_break",
    },
    {
        name: "unbreakable barrier",
        setup: (bot) => placeAndWait(bot, `/setblock ${P.join(" ")} barrier`, P, "barrier"),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: "unbreakable",
    },
    {
        name: "stone without a pickaxe",
        setup: (bot) => placeAndWait(bot, `/setblock ${P.join(" ")} stone`, P, "stone"),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: "no_tool",
    },
];

const edgeCases = [topOfColumn("ok"), ...commonEdgeCases];

export const skill = "break_block";
export { brokenAndCollected, commonEdgeCases, edgeCases, nominal, nominalCases, topOfColumn };
