const { goals } = require('mineflayer-pathfinder')
const { raisonDeplacement, vecteur, arrondi, compterModifications } = require('./outils')

// Aller à une position. Le pathfinder se débrouille seul avec les obstacles (voir src/movements.js) :
// il saute, creuse un passage, monte en tour avec de la terre, ouvre les portes, évite la lave.
async function move_to(bot, { x, y, z, range = 1 } = {}) {
    // 1. Les coordonnées doivent être des nombres
    if (![x, y, z, range].every(Number.isFinite) || range < 0) {
        return { success: false, reason: 'invalid_args', details: { x, y, z, range } }
    }

    const target = [x, y, z]
    const arreterCompte = compterModifications(bot)
    // Où en est-on par rapport à la cible, et qu'a-t-on modifié en route ?
    const bilan = () => {
        const p = bot.entity.position
        return {
            target,
            position: [p.x, p.y, p.z].map(arrondi),
            distance: arrondi(p.distanceTo(vecteur(bot, x, y, z))),
            ...arreterCompte(),
        }
    }

    try {
        // 2. Marcher jusqu'à être à moins de `range` blocs de la cible
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
    } catch (e) {
        return { success: false, reason: raisonDeplacement(e), details: { ...bilan(), error: e.message } }
    }

    // 3. Vérifier qu'on est vraiment arrivé (+1 car le pathfinder compte en blocs entiers)
    const arrivee = bilan()
    if (arrivee.distance > range + 1) return { success: false, reason: 'not_arrived', details: arrivee }
    return { success: true, reason: 'ok', details: arrivee }
}

module.exports = move_to
