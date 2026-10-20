// The bot's state: observe(bot) is THE single definition of "the current state" in the project.
// The API (GET /state), the journal (state / next_state) and later the world model all use it.
// The LLM does not read it raw: the brain (Python) renders a short text from it for the prompt.
// Every part is optional: if one cannot be read (e.g. biome unknown), it is null and the rest is
// still there. Shape documented in docs/journal.md.

// Slime, phantom... have type 'mob', not 'hostile': we add them by hand
const OTHER_HOSTILES = [
    "slime",
    "magma_cube",
    "phantom",
    "ghast",
    "shulker",
    "ender_dragon",
];

function isHostile(e) {
    return e.type === "hostile" || OTHER_HOSTILES.includes(e.name);
}

const GRID_RADIUS = 5; // grid of (2*5+1)^3 = 1331 blocks around the feet
const NOTABLE_RADII = [8, 16, 32];
const NOTABLE_EXTRA = [
    "water",
    "lava",
    "crafting_table",
    "furnace",
    "chest",
    "sand",
    "gravel",
    "clay",
];
const MAX_NOTABLE = 5000; // findBlocks cap (counts are then truncated, reported by notable_truncated)
const ENTITY_RADIUS = 16;
const MAX_ENTITIES = 20;

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Run fn(); return null instead of throwing
function attempt(fn) {
    try {
        const v = fn();
        return v === undefined ? null : v;
    } catch (e) {
        return null;
    }
}

// Blocks around the feet, encoded compactly: a palette of names + one palette index per cell.
// Cell order: for dy from -R to R, for dz from -R to R, for dx from -R to R
// (index = (dy+R)*S*S + (dz+R)*S + (dx+R), with S = 2R+1). Unloaded cells are null.
function blockGrid(bot, R) {
    const feet = bot.entity.position.floored();
    const palette = [];
    const cells = [];
    for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
                const b = bot.blockAt(feet.offset(dx, dy, dz));
                if (!b) {
                    cells.push(null);
                    continue;
                }
                let i = palette.indexOf(b.name);
                if (i === -1) i = palette.push(b.name) - 1;
                cells.push(i);
            }
        }
    }
    return { origin: [feet.x, feet.y, feet.z], radius: R, palette, cells };
}

// Notable blocks (logs, ores, NOTABLE_EXTRA): the nearest one (relative position, distance) and how
// many there are within 8, 16 and 32 blocks. Only loaded chunks are seen (view distance!).
function notableBlocks(bot) {
    const r = bot.registry;
    const names = Object.keys(r.blocksByName).filter(
        (n) =>
            n.endsWith("_log") ||
            n.endsWith("_ore") ||
            NOTABLE_EXTRA.includes(n),
    );
    const pos = bot.entity.position;
    const R = NOTABLE_RADII.at(-1);
    const found = bot.findBlocks({
        matching: names.map((n) => r.blocksByName[n].id),
        maxDistance: R,
        count: MAX_NOTABLE,
    });
    const result = {};
    for (const p of found) {
        const name = bot.blockAt(p).name;
        const d = p.distanceTo(pos);
        const entry =
            result[name] ||
            (result[name] = {
                nearest: null,
                distance: Infinity,
                ...Object.fromEntries(NOTABLE_RADII.map((x) => [`r${x}`, 0])),
            });
        for (const x of NOTABLE_RADII) if (d <= x) entry[`r${x}`]++;
        if (d < entry.distance) {
            entry.distance = r1(d);
            entry.nearest = [r1(p.x - pos.x), r1(p.y - pos.y), r1(p.z - pos.z)];
        }
    }
    return { blocks: result, truncated: found.length >= MAX_NOTABLE };
}

// The block in front of the bot at feet level (yaw 0 = facing north = -z)
function blockInFront(bot) {
    const e = bot.entity;
    const dx = Math.round(-Math.sin(e.yaw));
    const dz = Math.round(-Math.cos(e.yaw));
    const b = bot.blockAt(e.position.floored().offset(dx, 0, dz));
    return b ? b.name : null;
}

// An item slot as { name, count, durability_left? } (or null if empty)
function slot(item) {
    if (!item) return null;
    const s = { name: item.name, count: item.count };
    if (item.maxDurability)
        s.durability_left = item.maxDurability - (item.durabilityUsed || 0);
    return s;
}

// Deaths since the bot process started (call once in bot.js). In the state, so that the brain sees
// a death that happened BETWEEN two skills (e.g. while the LLM was thinking).
function trackDeaths(bot) {
    bot.deathCount = 0;
    bot.on("death", () => {
        bot.deathCount++;
    });
}

function observe(bot) {
    const e = bot.entity;
    const pos = e.position;
    const feetBlock = attempt(() => bot.blockAt(pos.floored()));

    // Inventory: counts { oak_log: 3 } (main and hotbar slots) + every non-empty slot in detail
    const inventory = {};
    for (const item of bot.inventory.items())
        inventory[item.name] = (inventory[item.name] || 0) + item.count;
    const notable = attempt(() => notableBlocks(bot));

    return {
        // Body
        position: [r3(pos.x), r3(pos.y), r3(pos.z)],
        yaw: attempt(() => r3(e.yaw)),
        pitch: attempt(() => r3(e.pitch)),
        velocity: attempt(() => [
            r3(e.velocity.x),
            r3(e.velocity.y),
            r3(e.velocity.z),
        ]),
        on_ground: attempt(() => e.onGround),
        in_water: attempt(() => !!e.isInWater),
        in_lava: attempt(() => !!e.isInLava),
        on_fire: attempt(() => ((e.metadata && e.metadata[0]) & 0x01) === 0x01), // bit 0 of the entity flags
        health: bot.health,
        food: bot.food,
        deaths: bot.deathCount ?? null, // since the bot process started
        food_saturation: attempt(() => bot.foodSaturation),
        oxygen: attempt(() => bot.oxygenLevel),
        xp_level: attempt(() => bot.experience.level),
        effects: attempt(() =>
            Object.values(e.effects || {}).map((x) => ({
                name: bot.registry.effects[x.id]?.name ?? x.id,
                amplifier: x.amplifier,
                duration: x.duration,
            })),
        ),
        // Inventory and equipment (armor = slots 5-8, off hand = slot 45 of the player inventory)
        inventory,
        inventory_slots: attempt(() =>
            bot.inventory.slots
                .map((item, i) => (item ? { slot: i, ...slot(item) } : null))
                .filter(Boolean),
        ),
        held_slot: attempt(() => bot.quickBarSlot), // 0-8, the selected hotbar slot
        held_item: attempt(() => slot(bot.heldItem)),
        armor: attempt(() => ({
            head: slot(bot.inventory.slots[5]),
            chest: slot(bot.inventory.slots[6]),
            legs: slot(bot.inventory.slots[7]),
            feet: slot(bot.inventory.slots[8]),
        })),
        off_hand: attempt(() => slot(bot.inventory.slots[45])),
        // World
        game_mode: attempt(() => bot.game.gameMode),
        difficulty: attempt(() => bot.game.difficulty),
        dimension: attempt(() => bot.game.dimension),
        // Mineflayer gives an empty biome name for this version: keep the id, and null rather than ""
        biome: attempt(() => feetBlock.biome.name || null),
        biome_id: attempt(() => feetBlock.biome.id),
        light: attempt(() => feetBlock.light),
        sky_light: attempt(() => feetBlock.skyLight),
        time_of_day: attempt(() => bot.time.timeOfDay),
        day: attempt(() => bot.time.day),
        moon_phase: attempt(() => bot.time.moonPhase), // 0 = full moon: more monsters at night
        raining: attempt(() => !!bot.isRaining),
        thunder: attempt(() => bot.thunderState > 0),
        // Surroundings (entity ids are stable during a run: they follow one mob across lines)
        entities: attempt(() =>
            Object.values(bot.entities)
                .filter(
                    (x) =>
                        x !== e &&
                        x.position &&
                        x.position.distanceTo(pos) <= ENTITY_RADIUS,
                )
                .map((x) => ({
                    id: x.id,
                    name: x.name || x.type,
                    type: x.type,
                    hostile: isHostile(x),
                    offset: [
                        r1(x.position.x - pos.x),
                        r1(x.position.y - pos.y),
                        r1(x.position.z - pos.z),
                    ],
                    distance: r1(x.position.distanceTo(pos)),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, MAX_ENTITIES),
        ),
        block_below: attempt(
            () => bot.blockAt(pos.floored().offset(0, -1, 0)).name,
        ),
        block_front: attempt(() => blockInFront(bot)),
        notable_blocks: notable ? notable.blocks : null,
        notable_truncated: notable ? notable.truncated : null,
        blocks: attempt(() => blockGrid(bot, GRID_RADIUS)),
    };
}

export { GRID_RADIUS, isHostile, observe, trackDeaths };
