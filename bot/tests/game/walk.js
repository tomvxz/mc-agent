import { CENTER as C, FLOOR_Y, onTower, placeAndWait } from "./arena.js";

const DISTANCE = 4;
// yaw in radians (Mineflayer, as in the state): 0 = north (-z), pi/2 = west, -pi/2 = east, pi = south
const HEADINGS = {
    north: [0, [0, -1]],
    west: [Math.PI / 2, [-1, 0]],
    east: [-Math.PI / 2, [1, 0]],
    south: [Math.PI, [0, 1]],
    south_west: [(3 * Math.PI) / 4, [-1, 1]],
};
const EAST = -Math.PI / 2;

// We really moved in the right direction, by about DISTANCE blocks
const movedTowards = ([dx, dz], min) => (r, before, after, bot) => {
    const p = bot.entity.position;
    const n = Math.hypot(dx, dz);
    const progress = ((p.x - (C.x + 0.5)) * dx + (p.z - (C.z + 0.5)) * dz) / n;
    return progress >= min || `only ${progress.toFixed(1)} blocks`;
};

const nominal = Object.entries(HEADINGS).map(([name, [yaw, heading]]) => ({
    name,
    args: { yaw, distance: DISTANCE },
    verify: movedTowards(heading, DISTANCE - 0.7),
}));

// A one-block step on the way: it jumps onto it and goes on
nominal.push({
    name: "jumps a one-block step",
    setup: (bot) =>
        placeAndWait(bot, `/fill ${C.x + 2} ${C.y} ${C.z - 1} ${C.x + 6} ${C.y} ${C.z + 1} stone`, [C.x + 2, C.y, C.z], "stone"),
    args: { yaw: EAST, distance: DISTANCE },
    verify: (r, before, after, bot) =>
        (bot.entity.position.y >= C.y + 1 && movedTowards([1, 0], DISTANCE - 0.7)(r, before, after, bot)) ||
        `ended at y=${bot.entity.position.y}`,
});

const edgeCases = [
    {
        name: "a two-block wall",
        setup: (bot) =>
            placeAndWait(bot, `/fill ${C.x + 2} ${C.y} ${C.z - 1} ${C.x + 2} ${C.y + 1} ${C.z + 1} stone`, [C.x + 2, C.y + 1, C.z], "stone"),
        args: { yaw: EAST, distance: DISTANCE },
        expect: "blocked",
    },
    {
        name: "stops at the edge of a 5-block drop",
        setup: onTower,
        args: { yaw: EAST, distance: DISTANCE },
        expect: "danger_ahead",
    },
    {
        name: "stops before lava",
        setup: (bot) =>
            placeAndWait(bot, `/setblock ${C.x + 2} ${FLOOR_Y} ${C.z} lava`, [C.x + 2, FLOOR_Y, C.z], "lava"),
        args: { yaw: EAST, distance: DISTANCE },
        expect: "danger_ahead",
    },
    { name: "yaw is not a number", args: { yaw: "east" }, expect: "invalid_args" },
];

export const skill = "walk";
export { edgeCases, nominal };
