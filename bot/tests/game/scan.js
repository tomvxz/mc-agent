import { waitUntil } from "../../src/skills/utils.js";
import { isHostile } from "../../src/state.js";
import { CENTER as C, placeAndWait, runCommand } from "./arena.js";

// What we place, and what scan must count exactly (all in plain sight from the center)
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
            if (!(await waitUntil(() => Object.values(bot.entities).some((e) => isHostile(bot, e)), 3000)))
                throw new Error("husk invisible");
        },
        args: { radius: 16 },
        verify: (r) => {
            for (const [name, ...positions] of PLACED) {
                const seen = r.details.blocks[name] ? r.details.blocks[name].count : 0;
                if (seen !== positions.length)
                    return `${name}: ${seen} instead of ${positions.length}`;
            }
            // Every kind in sight is reported (no list): the stone floor, the barrier walls too
            if (!r.details.blocks.stone) return "the floor (stone) is not reported";
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
