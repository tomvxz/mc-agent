// The pure part of the field bench (no game): reproducible random draws and the summary.
// Kept apart so that it can be tested without Minecraft (tests/unit/field.test.js).

// A small seeded random generator (mulberry32): the same seed always gives the same locations
function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const DIRECTIONS = [
    "north",
    "south",
    "east",
    "west",
    "north_east",
    "north_west",
    "south_east",
    "south_west",
];

// Everything random about one location, drawn once from the seed (so a location can be replayed alone)
function drawLocations(seed, n, spread = 2000) {
    const random = makeRandom(seed);
    const locations = [];
    for (let i = 0; i < n; i++) {
        locations.push({
            index: i,
            x: Math.round((random() * 2 - 1) * spread),
            z: Math.round((random() * 2 - 1) * spread),
            moveAngle: random() * 2 * Math.PI,
            moveDistance: 20 + Math.round(random() * 20), // 20 to 40 blocks
            exploreDirection: DIRECTIONS[Math.floor(random() * DIRECTIONS.length)],
        });
    }
    return locations;
}

const median = (values) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

// trials: [{ location, task, applicable, reason, success, duration, corrections }]
// -> per task: how many were tried, succeeded, and why the others failed
function summarize(trials) {
    const byTask = {};
    for (const t of trials) {
        const s =
            byTask[t.task] ||
            (byTask[t.task] = {
                tried: 0,
                succeeded: 0,
                not_applicable: 0,
                reasons: {},
                durations: [],
                with_corrections: 0,
            });
        if (!t.applicable) {
            s.not_applicable++;
            continue;
        }
        s.tried++;
        s.durations.push(t.duration);
        if (t.success) s.succeeded++;
        else s.reasons[t.reason] = (s.reasons[t.reason] || 0) + 1;
        // Many server position corrections = the server refused the bot's moves (suspected cause of "stuck")
        if (t.duration > 0 && t.corrections / t.duration > 5) s.with_corrections++;
    }
    for (const s of Object.values(byTask)) {
        s.rate = s.tried ? Math.round((100 * s.succeeded) / s.tried) : null;
        s.median_duration = median(s.durations);
        delete s.durations;
    }
    return byTask;
}

export { DIRECTIONS, drawLocations, makeRandom, summarize };
