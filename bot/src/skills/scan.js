const { round1 } = require('./utils')

// Useful blocks to report to the LLM (on top of every log and every ore)
const USEFUL = ['water', 'lava', 'crafting_table', 'furnace', 'chest', 'sand', 'gravel', 'clay']
const MAX_BLOCKS = 2000 // beyond this the count is truncated (reported by truncated)

// Question (changes nothing in the world): summary of what is around the bot.
// Broader than observe(): observe feeds the world model and must stay simple.
async function scan(bot, { radius = 16 } = {}) {
    if (!Number.isFinite(radius) || radius <= 0 || radius > 32) {
        return { success: false, reason: 'invalid_args', details: { radius } }
    }
    const pos = bot.entity.position
    const r = bot.registry

    // 1. Blocks: logs, ores and the USEFUL list
    const names = Object.keys(r.blocksByName).filter((n) => n.endsWith('_log') || n.endsWith('_ore') || USEFUL.includes(n))
    const positions = bot.findBlocks({ matching: names.map((n) => r.blocksByName[n].id), maxDistance: radius, count: MAX_BLOCKS })
    const blocks = {}
    for (const p of positions) {
        const name = bot.blockAt(p).name
        const d = p.distanceTo(pos)
        const b = blocks[name] || (blocks[name] = { count: 0, nearest: null, d: Infinity })
        b.count++
        if (d < b.d) { b.d = d; b.nearest = [p.x, p.y, p.z] }
    }
    for (const b of Object.values(blocks)) delete b.d // the distance was only needed for the computation

    // 2. Entities (animals, monsters, players, items on the ground), except the bot itself
    const entities = {}
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || !e.position) continue
        const d = e.position.distanceTo(pos)
        if (d > radius) continue
        const name = e.name || e.type
        const s = entities[name] || (entities[name] = { count: 0, nearest: null, distance: Infinity })
        s.count++
        if (d < s.distance) {
            s.distance = round1(d)
            s.nearest = [e.position.x, e.position.y, e.position.z].map(round1)
        }
    }

    return { success: true, reason: 'ok', details: { radius, blocks, entities, truncated: positions.length >= MAX_BLOCKS } }
}

module.exports = scan
