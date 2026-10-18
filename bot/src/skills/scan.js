const { arrondi } = require('./outils')

// Blocs utiles à signaler au LLM (en plus de toutes les bûches et de tous les minerais)
const UTILES = ['water', 'lava', 'crafting_table', 'furnace', 'chest', 'sand', 'gravel', 'clay']
const MAX_BLOCS = 2000 // au-delà, le comptage est tronqué (signalé par truncated)

// Question (ne change rien au monde) : résumé de ce qu'il y a autour du bot.
// Plus large que observe() : observe sert au world model et doit rester simple.
async function scan(bot, { radius = 16 } = {}) {
    if (!Number.isFinite(radius) || radius <= 0 || radius > 32) {
        return { success: false, reason: 'invalid_args', details: { radius } }
    }
    const pos = bot.entity.position
    const r = bot.registry

    // 1. Les blocs : bûches, minerais et la liste UTILES
    const noms = Object.keys(r.blocksByName).filter((n) => n.endsWith('_log') || n.endsWith('_ore') || UTILES.includes(n))
    const positions = bot.findBlocks({ matching: noms.map((n) => r.blocksByName[n].id), maxDistance: radius, count: MAX_BLOCS })
    const blocks = {}
    for (const p of positions) {
        const nom = bot.blockAt(p).name
        const d = p.distanceTo(pos)
        const b = blocks[nom] || (blocks[nom] = { count: 0, nearest: null, d: Infinity })
        b.count++
        if (d < b.d) { b.d = d; b.nearest = [p.x, p.y, p.z] }
    }
    for (const b of Object.values(blocks)) delete b.d // la distance ne servait qu'au calcul

    // 2. Les entités (animaux, monstres, joueurs, objets au sol), sauf le bot lui-même
    const entities = {}
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || !e.position) continue
        const d = e.position.distanceTo(pos)
        if (d > radius) continue
        const nom = e.name || e.type
        const s = entities[nom] || (entities[nom] = { count: 0, nearest: null, distance: Infinity })
        s.count++
        if (d < s.distance) {
            s.distance = arrondi(d)
            s.nearest = [e.position.x, e.position.y, e.position.z].map(arrondi)
        }
    }

    return { success: true, reason: 'ok', details: { radius, blocks, entities, truncated: positions.length >= MAX_BLOCS } }
}

module.exports = scan
