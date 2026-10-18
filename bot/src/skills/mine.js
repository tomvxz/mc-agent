// Raccourci : miner `count` blocs d'un type = find + break_block, répété.
// Ce n'est qu'un assemblage de primitives (voir CLAUDE.md, "Philosophie des compétences").
const find = require('./find')
const break_block = require('./break_block')
const { inventaire, gagne } = require('./outils')

// Échecs qui ne concernent que CE bloc-là : on essaie le suivant
const ESSAYER_UN_AUTRE = ['no_path', 'path_timeout', 'interrupted', 'nothing_to_break']
const MAX_ESSAIS = 20

async function mine(bot, { block, count = 1 } = {}) {
    // 1. Vérifier les arguments
    if (!bot.registry.blocksByName[block]) return { success: false, reason: 'unknown_block', details: {} }
    if (!Number.isInteger(count) || count < 1) return { success: false, reason: 'invalid_args', details: { count } }

    const avant = inventaire(bot)
    const total = () => Object.values(gagne(bot, avant)).reduce((a, b) => a + b, 0)
    const essayes = new Set() // positions déjà tentées, pour ne pas viser deux fois le même bloc
    let dug = 0
    let inaccessibles = 0

    while (dug < count) {
        // 2. Le bloc non encore tenté le plus proche
        const trouve = await find(bot, { target: block, count: 50, max_distance: 32 })
        const cible = trouve.success && trouve.details.matches.find((m) => !essayes.has(`${m.x},${m.y},${m.z}`))
        if (!cible || essayes.size >= MAX_ESSAIS) {
            const reason = dug > 0 ? 'partial' : inaccessibles > 0 ? 'no_path' : 'block_not_found'
            return { success: false, reason, details: { dug, collected: gagne(bot, avant), unreachable: inaccessibles } }
        }
        essayes.add(`${cible.x},${cible.y},${cible.z}`)

        // 3. Le casser (break_block s'approche et ramasse)
        const r = await break_block(bot, { x: cible.x, y: cible.y, z: cible.z })
        if (r.success) {
            dug++
        } else if (ESSAYER_UN_AUTRE.includes(r.reason)) {
            inaccessibles++
        } else {
            // no_tool, unbreakable, dig_failed... : le suivant échouerait pareil
            return { success: false, reason: r.reason, details: { dug, collected: gagne(bot, avant), ...r.details } }
        }
    }

    // 4. Casser ne suffit pas : il faut avoir récupéré quelque chose par bloc
    if (total() < dug) return { success: false, reason: 'not_collected', details: { dug, collected: gagne(bot, avant) } }
    return { success: true, reason: 'ok', details: { dug, collected: gagne(bot, avant), unreachable: inaccessibles } }
}

module.exports = mine
