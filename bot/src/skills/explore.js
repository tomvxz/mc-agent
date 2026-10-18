const { goals } = require('mineflayer-pathfinder')
const { raisonDeplacement, arrondi, compterModifications } = require('./outils')

// Dans Minecraft, le nord est vers -z et l'est vers +x
const DIRECTIONS = {
    north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
    north_east: [1, -1], north_west: [-1, -1], south_east: [1, 1], south_west: [-1, 1],
}

// Partir dans une direction pour découvrir de nouveaux endroits (quand find ne trouve rien).
// On ne connaît pas la hauteur d'arrivée : on vise seulement x et z.
async function explore(bot, { direction, distance = 32 } = {}) {
    if (!DIRECTIONS[direction] || !Number.isFinite(distance) || distance <= 0 || distance > 256) {
        return { success: false, reason: 'invalid_args', details: { direction, distance, directions: Object.keys(DIRECTIONS) } }
    }

    // 1. Le point visé, à `distance` blocs (en diagonale, on divise par √2 pour garder la distance)
    const [dx, dz] = DIRECTIONS[direction]
    const n = Math.hypot(dx, dz)
    // (on part de la case du bot : arrondir 1000,5 donnerait un décalage toujours du même côté)
    const depart = bot.entity.position.clone()
    const x = Math.floor(depart.x) + Math.round((dx / n) * distance)
    const z = Math.floor(depart.z) + Math.round((dz / n) * distance)

    const arreterCompte = compterModifications(bot)
    const bilan = () => {
        const p = bot.entity.position
        return {
            direction,
            start: [depart.x, depart.y, depart.z].map(arrondi),
            end: [p.x, p.y, p.z].map(arrondi),
            traveled: arrondi(Math.hypot(p.x - depart.x, p.z - depart.z)), // distance à plat
            ...arreterCompte(),
        }
    }

    try {
        // 2. Y aller (à 1 bloc près)
        await bot.pathfinder.goto(new goals.GoalNearXZ(x, z, 1))
    } catch (e) {
        return { success: false, reason: raisonDeplacement(e), details: { ...bilan(), error: e.message } }
    }
    return { success: true, reason: 'ok', details: bilan() }
}

module.exports = explore
