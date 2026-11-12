import { waitUntil } from "../../src/skills/utils.js";
import { CENTER as C, giveAndWait, onTower, placeAndWait, runCommand } from "./arena.js";

// A stone mass east of the bot (x+1 to x+12, 7 wide, `height` high from the bot's feet), with a pickaxe.
// 7 wide: thick walls, as underground. With 3, an ore in the wall had an open face outside the mass and
// its item could fall out there (seen: a coal item lost on the other side of the wall).
async function stoneMass(bot, height = 4, pickaxe = "wooden_pickaxe") {
    const top = C.y + height - 1;
    await placeAndWait(bot, `/fill ${C.x + 1} ${C.y} ${C.z - 3} ${C.x + 12} ${top} ${C.z + 3} stone`, [C.x + 12, top, C.z + 3], "stone");
    if (pickaxe) await giveAndWait(bot, pickaxe, 1);
}

// The bot ended in the tunnel cell (x+dx, y+dy), and the cells of a 1x2 tunnel behind it are empty
const inTunnel = (dx, dy) => (r, before, after, bot) => {
    const p = bot.entity.position;
    const cell = [Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z)];
    const want = [C.x + dx, C.y + dy, C.z];
    if (cell.join() !== want.join()) return `ended in ${cell}, expected ${want}`;
    const air = (x, y) => bot.blockAt(p.clone().set(x, y, C.z))?.boundingBox === "empty";
    for (let i = 1; i <= dx; i++) {
        const y = C.y + Math.round((dy * i) / dx);
        if (!air(C.x + i, y) || !air(C.x + i, y + 1)) return `the tunnel is not open at x+${i}`;
    }
    return true;
};

const nominal = [
    {
        name: "level tunnel through stone, 5 blocks",
        setup: (bot) => stoneMass(bot),
        args: { direction: "east", distance: 5 },
        verify: inTunnel(5, 0),
    },
    {
        name: "staircase up, 3 blocks",
        setup: (bot) => stoneMass(bot, 7),
        args: { direction: "east", distance: 3, slope: "up" },
        verify: inTunnel(3, 3),
    },
    {
        name: "staircase down, 3 blocks (from the top of the mass)",
        setup: async (bot) => {
            await placeAndWait(bot, `/fill ${C.x - 1} ${C.y} ${C.z - 1} ${C.x + 10} ${C.y + 5} ${C.z + 1} stone`, [C.x + 10, C.y + 5, C.z + 1], "stone");
            await giveAndWait(bot, "wooden_pickaxe", 1);
            await runCommand(bot, `/tp ${bot.username} ${C.x + 0.5} ${C.y + 6} ${C.z + 0.5}`);
            if (!(await waitUntil(() => bot.entity.position.y >= C.y + 6 && bot.entity.onGround, 3000)))
                throw new Error("the bot is not on the mass"); // setup failed
        },
        args: { direction: "east", distance: 3, slope: "down" },
        verify: (r, before, after, bot) => {
            const p = bot.entity.position;
            return (Math.floor(p.y + 0.01) === C.y + 3 && Math.floor(p.x) === C.x + 3) || `ended at ${p}`;
        },
    },
    {
        // The ore is in the wall at the 4th block: hidden until that block is dug
        name: "stops when an iron ore comes into sight",
        setup: async (bot) => {
            await stoneMass(bot, 4, "stone_pickaxe");
            await placeAndWait(bot, `/setblock ${C.x + 4} ${C.y + 1} ${C.z + 1} iron_ore`, [C.x + 4, C.y + 1, C.z + 1], "iron_ore");
        },
        args: { direction: "east", distance: 8, stop_at: ["#iron_ores"] },
        verify: (r) =>
            (r.details.stopped_by === "found" &&
                r.details.dug === 4 &&
                r.details.found.some((b) => b.x === C.x + 4 && b.y === C.y + 1 && b.z === C.z + 1)) ||
            `stopped_by ${r.details.stopped_by}, dug ${r.details.dug}`,
    },
];

const edgeCases = [
    {
        name: "lava behind the stone: not broken",
        setup: async (bot) => {
            await stoneMass(bot);
            await placeAndWait(bot, `/setblock ${C.x + 3} ${C.y} ${C.z} lava`, [C.x + 3, C.y, C.z], "lava");
        },
        args: { direction: "east", distance: 5 },
        expect: "danger_ahead",
    },
    {
        name: "stone without a pickaxe",
        setup: (bot) => stoneMass(bot, 4, null),
        args: { direction: "east", distance: 3 },
        expect: "no_tool",
    },
    {
        name: "the tunnel opens onto a void (edge of a tower)",
        setup: onTower,
        args: { direction: "east", distance: 4 },
        expect: "opening",
    },
    { name: "a slope is not a direction", args: { direction: "up" }, expect: "invalid_args" },
];

export const skill = "dig";
export { edgeCases, nominal, stoneMass };
