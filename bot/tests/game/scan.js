import { waitUntil } from "../../src/skills/utils.js";
import { isHostile } from "../../src/state.js";
import { CENTER as C, placeAndWait, runCommand } from "./arena.js";

// What we place, and what scan must count exactly
const PLACED = [
    ["oak_log", [3, 0], [3, 1], [3, 2]],
    ["iron_ore", [-5, 4], [-6, 4]],
    ["crafting_table", [0, -7]],
];

const nominal = [
    {
        name: "counts what was placed",
        setup: async (bot) => {
            for (const [name, ...positions] of PLACED) {
                for (const [dx, dz] of positions)
                    await placeAndWait(
                        bot,
                        `/setblock ${C.x + dx} ${C.y} ${C.z + dz} ${name}`,
                        [C.x + dx, C.y, C.z + dz],
                        name,
                    );
            }
            await runCommand(bot, `/summon husk ${C.x + 8.5} ${C.y} ${C.z + 0.5} {NoAI:1b}`);
            if (!(await waitUntil(() => Object.values(bot.entities).some(isHostile), 3000)))
                throw new Error("husk invisible");
        },
        args: { radius: 16 },
        verify: (r) => {
            for (const [name, ...positions] of PLACED) {
                const seen = r.details.blocks[name] ? r.details.blocks[name].count : 0;
                if (seen !== positions.length)
                    return `${name}: ${seen} instead of ${positions.length}`;
            }
            const extra = Object.keys(r.details.blocks).filter(
                (n) => !PLACED.some(([name]) => name === n),
            );
            if (extra.length) return `unexpected blocks: ${extra.join(", ")}`;
            return (
                (r.details.entities.husk && r.details.entities.husk.count === 1) ||
                "husk not counted"
            );
        },
    },
];

const edgeCases = [{ name: "invalid radius", args: { radius: 100 }, expect: "invalid_args" }];

export const skill = "scan";
export { edgeCases, nominal };
