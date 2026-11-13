import assert from "node:assert/strict";
import test from "node:test";
import prismarineBlock from "prismarine-block";
import prismarineChunk from "prismarine-chunk";
import prismarineRegistry from "prismarine-registry";
import prismarineWorld from "prismarine-world";
import { Vec3 } from "vec3";
import { seesCell } from "../../src/observation/perception.js";
import { blockGrid, blockState, observe, packBits } from "../../src/observation/state.js";
import { fakeBot, MC_VERSION, Point } from "./fakeBot.js";

test("state: a block in the game's notation, with its state sorted", () => {
    assert.equal(blockState({ name: "stone", getProperties: () => ({}) }), "stone");
    assert.equal(
        blockState({ name: "oak_door", getProperties: () => ({ open: true, facing: "north" }) }),
        "oak_door[facing=north,open=true]",
    );
});

test("state: the visibility mask packs one bit per cell (cell i -> byte i >> 3, bit i & 7)", () => {
    assert.equal(packBits([1, 0, 0, 0, 0, 0, 0, 0, 1]), Buffer.from([1, 1]).toString("base64"));
    assert.equal(packBits([0, 1, 1]), Buffer.from([6]).toString("base64"));
});

test("state: entities say what lies on the ground, who is hostile (game category), no health", () => {
    const at = (x) => new Point(0.5 + x, 100, 0.5);
    const entities = {
        1: { id: 1, name: "item", type: "object", position: at(2), getDroppedItem: () => ({ name: "oak_log", count: 3 }) },
        2: { id: 2, name: "zombie", type: "hostile", position: at(4), health: 20 },
        3: { id: 3, name: "slime", type: "mob", position: at(5) }, // type mob, category Hostile mobs
        4: { id: 4, name: "pig", type: "animal", position: at(6) },
        5: { id: 5, name: "player", type: "player", username: "Steve", position: at(7) },
    };
    const s = observe(fakeBot({ entities }));
    const byId = Object.fromEntries(s.entities.map((e) => [e.id, e]));
    assert.deepEqual(byId[1].item, { name: "oak_log", count: 3 });
    assert.deepEqual([2, 3, 4].map((id) => byId[id].hostile), [true, true, false]);
    assert.equal(byId[5].username, "Steve");
    assert.equal("health" in byId[2], false);
    assert.equal(byId[2].visible, true); // the fake world hides nothing
    assert.equal("block_below" in s, false); // recomputed from the grid
    assert.equal(typeof s.blocks.visible, "string");
});

// A wall of stone at x=3 (y 100-101, z -1..1), a log at x=5 behind it (hidden), a trunk at x=9 (y 100-104)
// whose top shows above the wall. The bot is at (0.5, 100, 0.5), eyes at y 101.62. Real lines of sight
// through the fake blocks (the rays read blockAt).
function wallScene() {
    const blocks = { "5,100,0": "spruce_log" };
    for (let y = 100; y <= 104; y++) blocks[`9,${y},0`] = "spruce_log";
    for (let y = 100; y <= 101; y++) for (let z = -1; z <= 1; z++) blocks[`3,${y},${z}`] = "stone";
    return fakeBot({ blocks });
}

test("perception: find only sees what is in line of sight; with \"all\", everything", async () => {
    const { setPerception } = await import("../../src/observation/perception.js");
    const { default: find } = await import("../../src/skills/questions/find.js");
    const sight = await find(wallScene(), { target: "spruce_log", count: 10 });
    assert.ok(sight.details.matches.every((m) => m.x === 9), JSON.stringify(sight.details.matches));
    assert.ok(sight.details.matches.some((m) => m.y >= 102)); // the top of the trunk, above the wall
    setPerception("all");
    try {
        const all = await find(wallScene(), { target: "spruce_log", count: 10 });
        assert.equal(all.details.matches[0].x, 5); // the hidden log too, nearest first
    } finally {
        setPerception("sight");
    }
    assert.throws(() => setPerception("xray"), /unknown perception/);
});

// The index of the grid cell at (x, y, z), as docs/journal.md says
function cellIndex(grid, x, y, z) {
    const R = grid.radius;
    const S = 2 * R + 1;
    const [ox, oy, oz] = grid.origin;
    return (y - oy + R) * S * S + (z - oz + R) * S + (x - ox + R);
}

// Is the grid cell at (x, y, z) marked visible (decodes the mask as docs/journal.md says)
function cellVisible(grid, x, y, z) {
    const i = cellIndex(grid, x, y, z);
    return (Buffer.from(grid.visible, "base64")[i >> 3] & (1 << (i & 7))) !== 0;
}

test("state: in_sight lists every kind of block seen, the grid marks the hidden cells", async () => {
    const { setPerception } = await import("../../src/observation/perception.js");
    const s = observe(wallScene());
    assert.equal(s.in_sight.spruce_log.nearest[0], 8.5); // the trunk at x=9, not the hidden log at x=5
    assert.ok(s.in_sight.stone.count >= 1); // the wall itself is seen: no list of kinds
    // The grid holds the hidden log (everything known) but marks it not visible; the wall's face and
    // the air between are visible, and so is the top of the trunk
    const g = s.blocks;
    assert.equal(g.palette[g.cells[cellIndex(g, 5, 100, 0)]], "spruce_log");
    assert.deepEqual(
        [cellVisible(g, 5, 100, 0), cellVisible(g, 3, 101, 0), cellVisible(g, 2, 101, 0), cellVisible(g, 9, 104, 0)],
        [false, true, true, true],
    );
    setPerception("all");
    try {
        assert.equal(observe(wallScene()).in_sight.spruce_log.nearest[0], 4.5); // x-ray: the hidden log
    } finally {
        setPerception("sight");
    }
});

// A small REAL world, the way Mineflayer keeps it (prismarine-world, real chunk columns), 3 x 3 chunks: ground,
// a log with its axis, water, and one chunk left unloaded. The fake bot reads blocks one by one; this one
// goes through the chunks directly, like the real bot.
async function realWorldBot() {
    const registry = prismarineRegistry(MC_VERSION);
    const World = prismarineWorld(registry);
    const Chunk = prismarineChunk(registry);
    const world = new World(null);
    const Block = prismarineBlock(registry);
    const stone = registry.blocksByName.stone.defaultState;
    const water = registry.blocksByName.water.defaultState;
    const log = Block.fromProperties("oak_log", { axis: "x" }, 1).stateId;
    for (const [cx, cz] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0]]) { // (1, 1): not loaded
        const c = new Chunk({ minY: -64, worldHeight: 384 });
        for (let x = 0; x < 16; x++)
            for (let z = 0; z < 16; z++)
                for (let y = 50; y < 64; y++) c.setBlockStateId(new Vec3(x, y, z), (x + z) % 7 === 0 && y === 63 ? water : stone);
        if (cx === 0 && cz === 0) c.setBlockStateId(new Vec3(4, 64, 2), log);
        await world.setColumn(cx, cz, c);
    }
    return { registry, world: world.sync, entity: { position: new Vec3(2.5, 64, 2.5), eyeHeight: 1.62 }, blockAt: (p) => world.sync.getBlock(p) };
}

test("state: the fast grid (chunks read directly) equals the plain one, block by block", async () => {
    const bot = await realWorldBot();
    const R = 16;
    const grid = blockGrid(bot, R);
    // The plain way: every cell through blockAt, its name with its state, and the line of sight
    const feet = bot.entity.position.floored();
    const palette = [];
    const cells = [];
    const visible = [];
    for (let dy = -R; dy <= R; dy++)
        for (let dz = -R; dz <= R; dz++)
            for (let dx = -R; dx <= R; dx++) {
                const p = feet.offset(dx, dy, dz);
                const b = bot.blockAt(p);
                if (!b) {
                    cells.push(null);
                    visible.push(false);
                    continue;
                }
                const name = blockState(b);
                if (!palette.includes(name)) palette.push(name);
                cells.push(palette.indexOf(name));
                visible.push(seesCell(bot, p));
            }
    assert.deepEqual(grid.palette, palette);
    assert.deepEqual(grid.cells, cells);
    assert.equal(grid.visible, packBits(visible));
    // The world is really in it: a log with its axis, water, seen and hidden cells, unloaded cells
    assert.ok(palette.includes("oak_log[axis=x]") && palette.some((n) => n.startsWith("water")));
    assert.ok(cells.includes(null) && visible.includes(true) && visible.includes(false));
});
