// What the bot PERCEIVES. The client knows more than a player sees: the server sends every block of the
// loaded chunks and every entity around, walls or not (X-ray). The journal keeps everything and marks
// what was visible (state.js); the questions (find, scan) and the brain's view only use what is
// perceived, by this setting:
//   "sight" (default): in line of sight from the eyes, in every direction (360 degrees around and
//                      up and down: as if the bot looked around, its head direction does not count)
//   "all":             everything the client knows (x-ray, to compare on the benches)
// MC_PERCEPTION in .env, or POST /setup { perception } for a bench. Later: + the memory of what was seen.
//
// How: like a screen, from the eyes and not from the blocks. A fan of rays spread evenly on the sphere
// goes out to SIGHT_RADIUS; each ray passes every cell it crosses (air, leaves, water, grass...) and
// stops at the first opaque block (full and not transparent in the game data). The cells crossed are
// what the bot sees ("looking around"). find, which looks for ONE kind of block up to 64 blocks
// away, checks each candidate with its own rays instead (a focused look).

const MODES = ["sight", "all"];
let mode = "sight";

function setPerception(m) {
    if (!MODES.includes(m)) throw new Error(`unknown perception "${m}": ${MODES.join(" or ")}`);
    mode = m;
}
setPerception(process.env.MC_PERCEPTION || "sight"); // a wrong value stops the bot at start

const perception = () => mode;

const SIGHT_RADIUS = 32;
// Angle between two neighbouring rays: 1.5 degrees, so that one block at 32 blocks (about 1.8 degrees
// wide) is still hit. 4 pi / angle^2 = about 18,000 rays. Measured on the server (2026-10-21, our DDA
// below): 13 ms in a cave, about 100 ms in open air (every ray goes the full 32 blocks).
const RAY_ANGLE = (1.5 * Math.PI) / 180;
const RAY_COUNT = Math.round((4 * Math.PI) / (RAY_ANGLE * RAY_ANGLE));

const eyes = (bot) => bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);

// N directions spread evenly on the sphere (Fibonacci sphere), computed once
let FAN = null;
function fan() {
    if (FAN) return FAN;
    const golden = Math.PI * (3 - Math.sqrt(5));
    FAN = [];
    for (let i = 0; i < RAY_COUNT; i++) {
        const y = 1 - (2 * (i + 0.5)) / RAY_COUNT;
        const r = Math.sqrt(1 - y * y);
        FAN.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
    }
    return FAN;
}

// Per state id, from the game data, computed once: is it opaque (stops sight), is it empty (air)
const tables = new WeakMap();
function tablesOf(bot) {
    if (tables.has(bot.registry)) return tables.get(bot.registry);
    const blocks = bot.registry.blocksArray;
    const size = Math.max(...blocks.map((b) => b.maxStateId)) + 1;
    const t = { opaque: new Uint8Array(size), empty: new Uint8Array(size) };
    for (const b of blocks) {
        if (!b.transparent && b.boundingBox === "block") t.opaque.fill(1, b.minStateId, b.maxStateId + 1);
        if (["air", "cave_air", "void_air"].includes(b.name)) t.empty.fill(1, b.minStateId, b.maxStateId + 1);
    }
    tables.set(bot.registry, t);
    return t;
}

// The state id at a cell, -1 if not loaded. Fast: reads the chunk column directly (no Block object,
// about 3x faster than Mineflayer's raycast); a fake bot without columns goes through blockAt.
function stateReader(bot) {
    const getColumn = bot.world.async?.getLoadedColumn?.bind(bot.world.async);
    if (!getColumn) {
        return (x, y, z) => {
            const b = bot.blockAt(bot.entity.position.clone().set(x, y, z));
            return b ? b.stateId : -1;
        };
    }
    const columns = new Map();
    const p = { x: 0, y: 0, z: 0 };
    return (x, y, z) => {
        const key = `${x >> 4},${z >> 4}`;
        let column = columns.get(key);
        if (column === undefined) {
            column = getColumn(x >> 4, z >> 4) || null;
            columns.set(key, column);
        }
        if (!column) return -1;
        p.x = x & 15;
        p.y = y;
        p.z = z & 15;
        return column.getBlockStateId(p);
    };
}

// Walk the cells crossed by a ray from `from` in direction d (unit), up to `range` (Amanatides-Woo).
// visit(x, y, z, stateId) is called for each cell; it returns true to stop the ray.
function walkRay(stateAt, from, d, range, visit) {
    const c = [Math.floor(from.x), Math.floor(from.y), Math.floor(from.z)];
    const o = [from.x, from.y, from.z];
    const step = d.map(Math.sign);
    const tDelta = d.map((v) => (v === 0 ? Infinity : Math.abs(1 / v)));
    const tMax = d.map((v, i) => (v > 0 ? (c[i] + 1 - o[i]) / v : v < 0 ? (o[i] - c[i]) / -v : Infinity));
    let t = 0;
    while (t <= range) {
        if (visit(c[0], c[1], c[2], stateAt(c[0], c[1], c[2]))) return;
        const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
        c[a] += step[a];
        t = tMax[a];
        tMax[a] += tDelta[a];
    }
}

// Is the point visible from the eyes: no opaque cell on the way (the cell `except`, the target, aside)?
function seen(bot, eye, point, except = null) {
    const d = [point.x - eye.x, point.y - eye.y, point.z - eye.z];
    const length = Math.hypot(...d);
    if (length < 0.01) return true;
    const { opaque } = tablesOf(bot);
    let blocked = false;
    walkRay(stateReader(bot), eye, d.map((v) => v / length), length, (x, y, z, s) => {
        if (except && x === except.x && y === except.y && z === except.z) return true; // reached the target
        if (s > 0 && opaque[s]) blocked = true;
        return blocked;
    });
    return !blocked;
}

// Is the block at p visible (a focused look, used by find): an opaque block by one of its faces turned
// to the eyes (a point just in front of the face: hidden if the next cell is opaque), any other cell by
// its center
function blockVisible(bot, eye, p, b) {
    const { opaque } = tablesOf(bot);
    const center = p.offset(0.5, 0.5, 0.5);
    if (!(b && b.stateId >= 0 && opaque[b.stateId])) return seen(bot, eye, center, p);
    for (const axis of ["x", "y", "z"]) {
        const d = eye[axis] - center[axis];
        if (Math.abs(d) <= 0.5) continue; // this face is turned away (or the eyes are level with it)
        const out = Math.sign(d) * 0.51;
        const face = center.offset(axis === "x" ? out : 0, axis === "y" ? out : 0, axis === "z" ? out : 0);
        if (seen(bot, eye, face, p)) return true;
    }
    return false;
}

// Is an entity visible: the middle of its body
const entityVisible = (bot, eye, e) => seen(bot, eye, e.position.offset(0, (e.height ?? 1) / 2, 0));

// --- Looking around: the cells the fan of rays crosses. Kept until the eyes move or a block changes
// (a skill's state before and after, a question that changes nothing: no second computation).
const views = new WeakMap(); // bot -> { key, version, cells }
const versions = new WeakMap(); // bot -> world version (+1 at each block change or chunk load)
function worldVersion(bot) {
    if (!versions.has(bot)) {
        versions.set(bot, 0);
        const bump = () => versions.set(bot, versions.get(bot) + 1);
        bot.world.on?.("blockUpdate", bump);
        bot.world.on?.("chunkColumnLoad", bump);
    }
    return versions.get(bot);
}

// Map "x,y,z" -> state id of every cell seen (empty ones too: seen empty space is known). The true
// view, whatever the setting (the journal's marks); xray: every cell the rays cross, walls or not.
function lookAround(bot, xray = false) {
    const eye = eyes(bot);
    const key = `${xray},${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}`;
    const version = worldVersion(bot);
    const cached = views.get(bot)?.[xray];
    if (cached && cached.key === key && cached.version === version) return cached.cells;
    const { opaque } = tablesOf(bot);
    const stateAt = stateReader(bot);
    const cells = new Map();
    for (const d of fan()) {
        walkRay(stateAt, eye, d, SIGHT_RADIUS, (x, y, z, s) => {
            if (s < 0) return true; // not loaded: nothing beyond
            cells.set(`${x},${y},${z}`, s);
            return !xray && opaque[s] === 1;
        });
    }
    views.set(bot, { ...views.get(bot), [xray]: { key, version, cells } });
    return cells;
}

// Does the bot see the cell at p, looking around (the true view)?
const seesCell = (bot, p) => lookAround(bot).has(`${p.x},${p.y},${p.z}`);

// What is perceived within radius (at most SIGHT_RADIUS): every kind of block (no list), with how many
// cells of it and the nearest one. { name: { count, nearest: [x, y, z], distance } }. With perception
// "all", what the x-ray fan crosses.
function inSight(bot, radius = SIGHT_RADIUS) {
    const { empty } = tablesOf(bot);
    const pos = bot.entity.position;
    const blocks = {};
    for (const [key, s] of lookAround(bot, mode === "all")) {
        if (s <= 0 || empty[s]) continue;
        const [x, y, z] = key.split(",").map(Number);
        const distance = Math.hypot(x - pos.x, y - pos.y, z - pos.z);
        if (distance > radius) continue;
        const name = bot.registry.blocksByStateId[s]?.name ?? String(s);
        const entry = blocks[name] || (blocks[name] = { count: 0, nearest: null, distance: Infinity });
        entry.count++;
        if (distance < entry.distance) {
            entry.distance = distance;
            entry.nearest = [x, y, z];
        }
    }
    return blocks;
}

// Does the bot perceive this block / entity, with the current setting? (a focused look: used by find)
const perceivesBlock = (bot, p) => mode === "all" || blockVisible(bot, eyes(bot), p, bot.blockAt(p));
const perceivesEntity = (bot, e) => mode === "all" || entityVisible(bot, eyes(bot), e);

export {
    blockVisible,
    entityVisible,
    eyes,
    inSight,
    lookAround,
    perceivesBlock,
    perceivesEntity,
    perception,
    RAY_COUNT,
    seen,
    seesCell,
    setPerception,
    SIGHT_RADIUS,
};
