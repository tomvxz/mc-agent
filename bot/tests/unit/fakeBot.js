// A fake bot, just realistic enough to test skills without Minecraft.
// We do not simulate the game: only what the skills read before acting.

const { EventEmitter } = require('events')
const registry = require('minecraft-data')('1.21.11')

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
}

// options: { inventory: { bread: 2 }, food: 20, blocks: { '0,0,0': 'stone' }, entities: [...] }
function fakeBot(options = {}) {
    const inventory = Object.entries(options.inventory || {}).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }))
    const blocks = options.blocks || {}

    // Object.assign onto an EventEmitter: the fake bot supports bot.on(...) like the real one
    return Object.assign(new EventEmitter(), {
        registry,
        username: 'Agent',
        food: options.food ?? 20,
        health: 20,
        time: { timeOfDay: 1000 },
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
                boundingBox: info.boundingBox,
            }
        },
        findBlock: () => null,
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
        // A game action called by mistake must make the test fail
        equip: async () => { throw new Error('equip should not be called') },
        consume: async () => { throw new Error('consume should not be called') },
        dig: async () => { throw new Error('dig should not be called') },
    })
}

module.exports = { fakeBot, Point }
