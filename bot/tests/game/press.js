import { CENTER as C, placeAndWait } from "./arena.js";

// Face east first (yaw -pi/2 in Mineflayer): "forward" then moves to +x
const faceEast = (bot) => bot.look(-Math.PI / 2, 0, true);

const movedEast = (min) => (r, before, after, bot) => {
    const dx = bot.entity.position.x - (C.x + 0.5);
    return dx >= min || `moved ${dx.toFixed(1)} blocks east`;
};

const nominal = [
    { name: "forward 20 ticks", setup: faceEast, args: { keys: ["forward"], ticks: 20 }, verify: movedEast(3) },
    { name: "sprint forward 20 ticks", setup: faceEast, args: { keys: ["forward", "sprint"], ticks: 20 }, verify: movedEast(4) },
    {
        name: "jump in place",
        args: { keys: ["jump"], ticks: 5 },
        verify: (r) => r.details.moved < 1.5 || `moved ${r.details.moved}`,
    },
    {
        name: "jumps onto a block while walking",
        setup: async (bot) => {
            await faceEast(bot);
            await placeAndWait(bot, `/setblock ${C.x + 2} ${C.y} ${C.z} stone`, [C.x + 2, C.y, C.z], "stone");
        },
        args: { keys: ["forward", "jump"], ticks: 20 },
        verify: (r, before, after, bot) => bot.entity.position.y >= C.y + 1 || `ended at y=${bot.entity.position.y}`,
    },
];

const edgeCases = [
    { name: "unknown key", args: { keys: ["fly"] }, expect: "invalid_args" },
];

export const skill = "press";
export { edgeCases, nominal };
