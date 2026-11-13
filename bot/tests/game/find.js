import { waitUntil } from "../../src/skills/utils.js";
import { isHostile } from "../../src/observation/state.js";
import { CENTER as C, placeAndWait, runCommand } from "./arena.js";

// Logs at known distances: the nearest must come first
const LOGS = [
    [12, 0],
    [3, 4],
    [-15, -10],
]; // [dx, dz] -> distances ~12, 5, 18
const NEAREST = [C.x + 3, C.y, C.z + 4];

const nominal = [
    {
        name: "logs sorted by distance",
        setup: async (bot) => {
            for (const [dx, dz] of LOGS)
                await placeAndWait(
                    bot,
                    `/setblock ${C.x + dx} ${C.y} ${C.z + dz} oak_log`,
                    [C.x + dx, C.y, C.z + dz],
                    "oak_log",
                );
        },
        args: { target: "oak_log" },
        verify: (r) => {
            const m = r.details.matches;
            if (m.length !== LOGS.length) return `${m.length} logs found instead of ${LOGS.length}`;
            const first = [m[0].x, m[0].y, m[0].z].join(",");
            return first === NEAREST.join(",") || `the reported nearest is ${first}`;
        },
    },
    {
        name: 'a husk found with "hostile"',
        setup: async (bot) => {
            await runCommand(bot, `/summon husk ${C.x + 6.5} ${C.y} ${C.z + 0.5} {NoAI:1b}`);
            if (!(await waitUntil(() => Object.values(bot.entities).some((e) => isHostile(bot, e)), 3000)))
                throw new Error("husk invisible");
        },
        args: { target: "hostile" },
        verify: (r) =>
            (r.details.matches[0].name === "husk" &&
                Math.abs(r.details.matches[0].distance - 6) < 1.5) ||
            `found: ${JSON.stringify(r.details.matches[0])}`,
    },
];

const edgeCases = [
    { name: "nothing like that around", args: { target: "diamond_ore" }, expect: "not_found" },
    {
        // The client knows the log (the server sends every block), but the bot cannot see it: with the default
        // perception (line of sight, src/observation/perception.js) find must not report it
        name: "a log enclosed in stone is not seen",
        setup: async (bot) => {
            await placeAndWait(
                bot,
                `/fill ${C.x + 4} ${C.y} ${C.z - 1} ${C.x + 6} ${C.y + 2} ${C.z + 1} stone`,
                [C.x + 6, C.y + 2, C.z + 1],
                "stone",
            );
            await placeAndWait(bot, `/setblock ${C.x + 5} ${C.y + 1} ${C.z} oak_log`, [C.x + 5, C.y + 1, C.z], "oak_log");
        },
        args: { target: "oak_log" },
        expect: "not_found",
    },
    { name: "unknown target", args: { target: "no_such_thing" }, expect: "unknown_target" },
];

export const skill = "find";
export { edgeCases, nominal };
