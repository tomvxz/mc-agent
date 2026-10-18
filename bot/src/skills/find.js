const { isHostile } = require('../state')
const { arrondi } = require('./outils')

// Question (ne change rien au monde) : où sont les blocs ou les entités d'un type donné ?
// target : un nom de bloc ("oak_log"), un nom d'entité ("cow") ou "hostile" (tous les monstres).
// Ne voit que les chunks chargés autour du bot.
async function find(bot, { target, count = 5, max_distance = 64 } = {}) {
    // 1. Vérifier les arguments
    const ok = typeof target === 'string' && Number.isInteger(count) && count >= 1 && count <= 50 &&
        Number.isFinite(max_distance) && max_distance > 0 && max_distance <= 64
    if (!ok) return { success: false, reason: 'invalid_args', details: { target, count, max_distance } }

    const pos = bot.entity.position
    const bloc = bot.registry.blocksByName[target]
    let matches

    if (bloc) {
        // 2a. Des blocs : on en cherche plus que demandé puis on trie par distance
        matches = bot.findBlocks({ matching: bloc.id, maxDistance: max_distance, count: Math.max(count * 10, 100) })
            .map((p) => ({ x: p.x, y: p.y, z: p.z, distance: arrondi(p.distanceTo(pos)) }))
    } else if (target === 'hostile' || bot.registry.entitiesByName[target]) {
        // 2b. Des entités (le bot lui-même est exclu)
        const correspond = (e) => (target === 'hostile' ? isHostile(e) : e.name === target)
        matches = Object.values(bot.entities)
            .filter((e) => e !== bot.entity && e.position && correspond(e) && e.position.distanceTo(pos) <= max_distance)
            .map((e) => ({ name: e.name, x: arrondi(e.position.x), y: arrondi(e.position.y), z: arrondi(e.position.z), distance: arrondi(e.position.distanceTo(pos)) }))
    } else {
        return { success: false, reason: 'unknown_target', details: { target } }
    }

    // 3. Du plus proche au plus loin
    matches.sort((a, b) => a.distance - b.distance)
    if (matches.length === 0) return { success: false, reason: 'not_found', details: { target, max_distance } }
    return { success: true, reason: 'ok', details: { target, matches: matches.slice(0, count) } }
}

module.exports = find
