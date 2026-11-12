// The bot's state: observe(bot) is THE single definition of "the current state" in the project.
// The API (GET /state), the journal (state / next_state) and later the world model all use it.
// The LLM does not read it raw: the brain (Python) renders a short text from it for the prompt.
// Every part is optional: if one cannot be read (e.g. biome unknown), it is null and the rest is
// still there. Shape documented in docs/journal.md.

import { entityVisible, eyes, inSight, perception, seesCell, SIGHT_RADIUS } from "./perception.js";

// Hostile = the game data's category "Hostile mobs" (minecraft-data), not a list of ours. It also holds
// the neutral mobs that attack when provoked (enderman, piglin, spider...) and the end crystal.
function isHostile(bot, e) {
    return bot.registry.entitiesByName[e.name]?.category === "Hostile mobs";
}

// Grid of (2*8+1)^3 = 4913 blocks around the feet: the reach of actions (4.5), jumps and falls, a few
// blocks of the way. Measured: 11 KB, +13 ms over radius 5. Farther: in_sight (32 blocks, what is seen).
const GRID_RADIUS = 8;
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

// A block with its state, in the game's own notation: "oak_log[axis=y]", "snow[layers=3]", "stone"
function blockState(b) {
    const props = b.getProperties ? b.getProperties() : {};
    const keys = Object.keys(props).sort();
    return keys.length === 0 ? b.name : `${b.name}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}

// One bit per cell, 1 = visible, packed in bytes (cell i -> byte i >> 3, bit i & 7), base64
function packBits(bits) {
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    bits.forEach((b, i) => {
        if (b) bytes[i >> 3] |= 1 << (i & 7);
    });
    return Buffer.from(bytes).toString("base64");
}

// Blocks around the feet, encoded compactly: a palette of block states + one palette index per cell,
// and which cells the bot could see (visible, packBits; see src/perception.js). Cell order: for dy from -R to R, for dz from
// -R to R, for dx from -R to R (index = (dy+R)*S*S + (dz+R)*S + (dx+R), with S = 2R+1). Unloaded cells
// are null (and not visible).
function blockGrid(bot, R) {
    const feet = bot.entity.position.floored();
    const palette = [];
    const cells = [];
    const visible = [];
    for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
                const p = feet.offset(dx, dy, dz);
                const b = bot.blockAt(p);
                if (!b) {
                    cells.push(null);
                    visible.push(false);
                    continue;
                }
                const name = blockState(b);
                let i = palette.indexOf(name);
                if (i === -1) i = palette.push(name) - 1;
                cells.push(i);
                visible.push(seesCell(bot, p));
            }
        }
    }
    return { origin: [feet.x, feet.y, feet.z], radius: R, palette, cells, visible: packBits(visible) };
}

// What the bot looks at (the game's crosshair, within reach: 4.5 blocks): the block and the face,
// or null
function lookingAt(bot) {
    const b = bot.blockAtCursor(4.5);
    if (!b) return null;
    return {
        block: blockState(b),
        position: [b.position.x, b.position.y, b.position.z],
        face: b.face ?? null, // 0 = bottom, 1 = top, 2 = north, 3 = south, 4 = west, 5 = east
        distance: r1(b.intersect ? b.intersect.distanceTo(eyes(bot)) : b.position.distanceTo(bot.entity.position)),
    };
}

// An item slot as { name, count, durability_left?, enchantments? } (or null if empty)
function slot(item) {
    if (!item) return null;
    const s = { name: item.name, count: item.count };
    if (item.maxDurability)
        s.durability_left = item.maxDurability - (item.durabilityUsed || 0);
    const enchants = attempt(() => item.enchants);
    if (enchants && enchants.length > 0) s.enchantments = enchants.map((e) => ({ name: e.name, level: e.lvl }));
    return s;
}

// Fall distance: how far the bot has fallen since it last stood on the ground or swam (call once
// in bot.js). Mineflayer does not keep it; the game uses it for fall damage (more than 3 blocks).
function trackFall(bot) {
    bot.fallDistance = 0;
    let lastY = null;
    bot.on("physicsTick", () => {
        const e = bot.entity;
        if (!e) return;
        if (e.onGround || e.isInWater || e.isInLava || lastY === null) bot.fallDistance = 0;
        else if (e.position.y < lastY) bot.fallDistance += lastY - e.position.y;
        lastY = e.position.y;
    });
}

// Deaths since the bot process started (call once in bot.js). In the state, so that the brain sees
// a death that happened BETWEEN two skills (e.g. while the LLM was thinking).
function trackDeaths(bot) {
    bot.deathCount = 0;
    bot.on("death", () => {
        bot.deathCount++;
    });
}

// The in_sight summary: { name: { count, nearest: offset, distance } }
function sightView(bot, pos) {
    const view = {};
    for (const [name, b] of Object.entries(inSight(bot, SIGHT_RADIUS)))
        view[name] = {
            count: b.count,
            nearest: [r1(b.nearest[0] - pos.x), r1(b.nearest[1] - pos.y), r1(b.nearest[2] - pos.z)],
            distance: r1(b.distance),
        };
    return view;
}

// One entity as the state shows it
function entityView(bot, x, pos, eye) {
    const view = {
        id: x.id,
        name: x.name || x.type,
        type: x.type,
        hostile: isHostile(bot, x),
        offset: [r1(x.position.x - pos.x), r1(x.position.y - pos.y), r1(x.position.z - pos.z)],
        distance: r1(x.position.distanceTo(pos)),
        velocity: attempt(() => [r3(x.velocity.x), r3(x.velocity.y), r3(x.velocity.z)]),
        yaw: attempt(() => r3(x.yaw)),
        // Seen from the eyes: the middle of its body (360 degrees, like the blocks)
        visible: attempt(() => entityVisible(bot, eye, x)),
    };
    if (x.type === "player" && x.username) view.username = x.username;
    const held = attempt(() => slot(x.heldItem));
    if (held) view.held_item = held;
    // An item lying on the ground: which item, how many
    if (x.name === "item") {
        const item = attempt(() => x.getDroppedItem());
        view.item = item ? { name: item.name, count: item.count } : null;
    }
    return view;
}

function observe(bot) {
    const e = bot.entity;
    const pos = e.position;
    const feetBlock = attempt(() => bot.blockAt(pos.floored()));

    // Inventory: counts { oak_log: 3 } (main and hotbar slots) + every non-empty slot in detail
    const inventory = {};
    for (const item of bot.inventory.items())
        inventory[item.name] = (inventory[item.name] || 0) + item.count;
    const eye = attempt(() => eyes(bot));

    return {
        // How the questions (find, scan) and the brain's view filter it (src/perception.js): "sight" = only
        // what is marked visible, "all" = everything
        perception: perception(),
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
        // The keys decide it on the client: sneaking and sprinting are what the bot is doing
        sneaking: attempt(() => bot.getControlState("sneak")),
        sprinting: attempt(() => bot.getControlState("sprint")),
        sleeping: attempt(() => !!bot.isSleeping),
        fall_distance: attempt(() => r3(bot.fallDistance)), // see trackFall
        health: bot.health,
        food: bot.food,
        deaths: bot.deathCount ?? null, // since the bot process started
        food_saturation: attempt(() => bot.foodSaturation),
        oxygen: attempt(() => bot.oxygenLevel),
        xp_level: attempt(() => bot.experience.level),
        xp_points: attempt(() => bot.experience.points), // total
        xp_progress: attempt(() => r3(bot.experience.progress)), // 0-1 towards the next level
        effects: attempt(() =>
            Object.values(e.effects || {}).map((x) => ({
                name: bot.registry.effects[x.id]?.name ?? x.id,
                amplifier: x.amplifier,
                duration: x.duration,
            })),
        ),
        // Inventory and equipment (armor = slots 5-8, off hand = slot 45 of the player inventory).
        // `inventory` (counts) can be recomputed from inventory_slots: kept on purpose, it is what
        // everything reads (the brain's text, the goal condition).
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
        // The block's biome has an empty name for this version: the name comes from the registry (the
        // server's list, checked against it on 2026-10-21)
        biome: attempt(() => bot.registry.biomes[feetBlock.biome.id].name || null),
        biome_id: attempt(() => feetBlock.biome.id),
        light: attempt(() => feetBlock.light),
        sky_light: attempt(() => feetBlock.skyLight),
        time_of_day: attempt(() => bot.time.timeOfDay),
        day: attempt(() => bot.time.day),
        moon_phase: attempt(() => bot.time.moonPhase), // 0 = full moon: more monsters at night
        raining: attempt(() => !!bot.isRaining),
        thunder: attempt(() => bot.thunderState > 0),
        // What the bot looks at (crosshair), and the entity it looks at (within 3.5 blocks: attack reach)
        looking_at: attempt(() => lookingAt(bot)),
        looking_at_entity: attempt(() => bot.entityAtCursor(3.5)?.id ?? null),
        // Surroundings (entity ids are stable during a run: they follow one mob across lines). No health:
        // a player does not see it.
        entities: attempt(() =>
            Object.values(bot.entities)
                .filter(
                    (x) =>
                        x !== e &&
                        x.position &&
                        x.position.distanceTo(pos) <= ENTITY_RADIUS,
                )
                .map((x) => entityView(bot, x, pos, eye))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, MAX_ENTITIES),
        ),
        // What is in sight within 32 blocks (src/perception.js): what a player has on screen when looking
        // around, not what lies behind walls. Offsets from the bot, like the entities.
        in_sight: attempt(() => sightView(bot, pos)),
        blocks: attempt(() => blockGrid(bot, GRID_RADIUS)),
    };
}

export { blockState, GRID_RADIUS, isHostile, observe, packBits, trackDeaths, trackFall };
