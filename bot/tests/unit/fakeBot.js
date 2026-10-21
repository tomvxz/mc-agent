// A fake bot, just realistic enough to test skills without Minecraft.
// We do not simulate the game: only what the skills read before acting.

import { EventEmitter } from 'node:events'
import minecraftData from 'minecraft-data'
import { recordTags } from '../../src/tags.js'
// The Minecraft version comes from .env (MC_VERSION), never written here: npm test reads ../.env
const MC_VERSION = process.env.MC_VERSION
if (!MC_VERSION) throw new Error('MC_VERSION is missing: run the tests with npm test (it reads ../.env)')
const registry = minecraftData(MC_VERSION)

// A minimal 3D point that mimics Mineflayer's Vec3
class Point {
    constructor(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
    }
    clone() { return new Point(this.x, this.y, this.z) }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this }
    offset(dx, dy, dz) { return new Point(this.x + dx, this.y + dy, this.z + dz) }
    floored() { return new Point(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) }
    distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) }
    toString() { return `${this.x},${this.y},${this.z}` }
    plus(p) { return new Point(this.x + p.x, this.y + p.y, this.z + p.z) }
    minus(p) { return new Point(this.x - p.x, this.y - p.y, this.z - p.z) }
    norm() { return Math.hypot(this.x, this.y, this.z) }
    // Like Vec3: normalize() changes the point itself (and returns it)
    normalize() { const n = this.norm(); this.x /= n; this.y /= n; this.z /= n; return this }
    equals(p) { return this.x === p.x && this.y === p.y && this.z === p.z }
}

// The block tags the server sends at login (src/tags.js), as read from Paper 1.21.11 on 2026-10-21.
// Beds, doors and fence gates: every block with that suffix (same lists as the server's).
const names = Object.keys(registry.blocksByName)
const TAGS = {
    air: ['air', 'void_air', 'cave_air'],
    replaceable: ['air', 'water', 'lava', 'short_grass', 'fern', 'dead_bush', 'bush', 'short_dry_grass', 'tall_dry_grass',
        'seagrass', 'tall_seagrass', 'fire', 'soul_fire', 'snow', 'vine', 'glow_lichen', 'resin_clump', 'light', 'tall_grass',
        'large_fern', 'structure_void', 'void_air', 'cave_air', 'bubble_column', 'warped_roots', 'nether_sprouts',
        'crimson_roots', 'leaf_litter', 'hanging_roots'],
    leaves: names.filter((n) => n.endsWith('_leaves')),
    ...Object.fromEntries(['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'].map((m) =>
        [`${m}_ores`, [`${m}_ore`, `deepslate_${m}_ore`]])),
    sand: ['sand', 'red_sand'],
    logs: names.filter((n) => n.endsWith('_log')), // the real one also has wood, stems...: enough here
    beds: names.filter((n) => n.endsWith('_bed')),
    doors: names.filter((n) => n.endsWith('_door')),
    fence_gates: names.filter((n) => n.endsWith('_fence_gate')),
}
// Item tags (as the server sends them, 2026-10-21): enough for recipes
const items = Object.keys(registry.itemsByName)
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'pale_oak', 'mangrove', 'cherry']
const ITEM_TAGS = {
    planks: items.filter((n) => n.endsWith('_planks')),
    logs: WOODS.flatMap((w) => [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]),
    ...Object.fromEntries(WOODS.map((w) => [`${w}_logs`, [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]])),
}
const TAGS_PACKET = {
    tags: [{
        tagType: 'minecraft:block',
        tags: Object.entries(TAGS).map(([name, blocks]) => ({
            tagName: `minecraft:${name}`, entries: blocks.map((n) => registry.blocksByName[n].id),
        })),
    }, {
        tagType: 'minecraft:item',
        tags: Object.entries(ITEM_TAGS).map(([name, list]) => ({
            tagName: `minecraft:${name}`, entries: list.map((n) => registry.itemsByName[n].id),
        })),
    }],
}

// options: { inventory: { bread: 2 }, food: 20, blocks: { '0,0,0': 'stone' }, entities: [...] }
function fakeBot(options = {}) {
    const inventory = Object.entries(options.inventory || {}).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }))
    const blocks = options.blocks || {}

    // Object.assign onto an EventEmitter: the fake bot supports bot.on(...) like the real one
    const bot = Object.assign(new EventEmitter(), {
        registry,
        username: 'Agent',
        food: options.food ?? 20,
        health: 20,
        time: { timeOfDay: 1000, age: 5000 },
        game: { gameMode: 'survival', difficulty: 'easy', dimension: 'overworld' },
        // The network client: some modules listen to raw packets (damage_event...)
        _client: Object.assign(new EventEmitter(), { write: () => {} }),
        entity: { position: new Point(0.5, 100, 0.5) },
        entities: options.entities || {},
        inventory: {
            items: () => inventory,
            count: (id) => inventory.filter((i) => registry.itemsByName[i.name].id === id).reduce((n, i) => n + i.count, 0),
        },
        // Unspecified blocks are air; the others take their properties from the real registry
        blockAt: (p) => {
            const name = blocks[`${p.x},${p.y},${p.z}`] || 'air'
            const info = registry.blocksByName[name]
            return {
                name, type: info.id, position: p, diggable: info.diggable, harvestTools: info.harvestTools,
                boundingBox: info.boundingBox, hardness: info.hardness, transparent: info.transparent, stateId: info.defaultState,
                shapes: info.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : [], // simplified: full or none
            }
        },
        findBlock: () => null,
        // No line of sight is computed: nothing hides anything (tests that need it set their own)
        world: { raycast: () => null },
        // Really searches `blocks` (matching = one id or a list of ids)
        findBlocks: ({ matching, maxDistance }) => {
            const ids = [].concat(matching)
            const center = new Point(0.5, 100, 0.5)
            return Object.entries(blocks)
                .filter(([, name]) => ids.includes(registry.blocksByName[name].id))
                .map(([key]) => new Point(...key.split(',').map(Number)))
                .filter((p) => p.distanceTo(center) <= maxDistance)
        },
        canDigBlock: () => true,
        canSeeBlock: () => true,
        recipesAll: () => [],
        recipesFor: () => [],
        pathfinder: {
            goto: async () => {},
            setGoal: () => {},
            bestHarvestTool: () => null,
        },
        stopDigging: () => {},
        // The keys held (forward, jump...), like Mineflayer's controlState
        controlState: {},
        setControlState(key, value) { this.controlState[key] = value },
        clearControlStates() { this.controlState = {} },
        // A game action called by mistake must make the test fail
        equip: async () => { throw new Error('equip should not be called') },
        consume: async () => { throw new Error('consume should not be called') },
        dig: async () => { throw new Error('dig should not be called') },
        look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch },
    })
    // Like the real bot: the tags arrive at login
    recordTags(bot)
    bot._client.emit('tags', TAGS_PACKET)
    return bot
}

export { fakeBot, Point, MC_VERSION }