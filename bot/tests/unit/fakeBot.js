// Un faux bot, juste assez réaliste pour tester les compétences sans Minecraft.
// On ne simule pas le jeu : seulement ce que les compétences lisent avant d'agir.

const { EventEmitter } = require('events')
const registry = require('minecraft-data')('1.21.11')

// Un point 3D minimal, qui imite le Vec3 de Mineflayer
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

// options : { inventory: { bread: 2 }, food: 20, blocks: { '0,0,0': 'stone' }, entities: [...] }
function fakeBot(options = {}) {
    const inventaire = Object.entries(options.inventory || {}).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }))
    const blocs = options.blocks || {}

    // Object.assign sur un EventEmitter : le faux bot sait faire bot.on(...) comme le vrai
    return Object.assign(new EventEmitter(), {
        registry,
        username: 'Agent',
        food: options.food ?? 20,
        health: 20,
        time: { timeOfDay: 1000 },
        entity: { position: new Point(0.5, 100, 0.5) },
        entities: options.entities || {},
        inventory: {
            items: () => inventaire,
            count: (id) => inventaire.filter((i) => registry.itemsByName[i.name].id === id).reduce((n, i) => n + i.count, 0),
        },
        // Les blocs non précisés sont de l'air ; les autres prennent leurs propriétés du vrai registre
        blockAt: (p) => {
            const name = blocs[`${p.x},${p.y},${p.z}`] || 'air'
            const info = registry.blocksByName[name]
            return {
                name, type: info.id, position: p, diggable: info.diggable, harvestTools: info.harvestTools,
                boundingBox: info.boundingBox,
            }
        },
        findBlock: () => null,
        // Cherche vraiment dans `blocks` (matching = un id ou une liste d'ids)
        findBlocks: ({ matching, maxDistance }) => {
            const ids = [].concat(matching)
            const centre = new Point(0.5, 100, 0.5)
            return Object.entries(blocs)
                .filter(([, name]) => ids.includes(registry.blocksByName[name].id))
                .map(([cle]) => new Point(...cle.split(',').map(Number)))
                .filter((p) => p.distanceTo(centre) <= maxDistance)
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
        // Une action du jeu appelée par erreur doit faire échouer le test
        equip: async () => { throw new Error('equip ne devrait pas être appelé') },
        consume: async () => { throw new Error('consume ne devrait pas être appelé') },
        dig: async () => { throw new Error('dig ne devrait pas être appelé') },
    })
}

module.exports = { fakeBot, Point }
