const { poser, MIN, MAX, CENTRE: C } = require('./arena')

const DISTANCE = 15 // l'arène fait 45 de large : on reste dedans
// Nord = -z, est = +x
const SENS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], north_east: [1, -1] }

const nominaux = Object.entries(SENS).map(([direction, [dx, dz]]) => ({
    nom: direction,
    args: { direction, distance: DISTANCE },
    // On a bien avancé dans la bonne direction, d'au moins 12 blocs
    verify: (r, avant, apres, bot) => {
        const p = bot.entity.position
        const n = Math.hypot(dx, dz)
        const avance = ((p.x - (C.x + 0.5)) * dx + (p.z - (C.z + 0.5)) * dz) / n
        return avance >= DISTANCE - 3 || `seulement ${avance.toFixed(1)} blocs dans la direction ${direction}`
    },
}))

const limites = [
    {
        nom: 'bloqué au nord par un mur incassable',
        setup: (bot) => poser(bot, `/fill ${MIN.x + 1} ${C.y} ${C.z - 5} ${MAX.x - 1} ${MAX.y - 1} ${C.z - 5} barrier`, [C.x, C.y, C.z - 5], 'barrier'),
        args: { direction: 'north', distance: DISTANCE },
        expect: 'no_path',
    },
    { nom: 'direction inconnue', args: { direction: 'haut' }, expect: 'invalid_args' },
]

module.exports = { skill: 'explore', nominaux, limites }
