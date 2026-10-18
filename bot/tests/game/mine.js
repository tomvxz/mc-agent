const { poser, CENTRE: C } = require('./arena')

// Pose une colonne de bûches de hauteur h (on attend que le bot voie celle du haut)
const colonne = (bot, dx, dz, h) =>
    poser(bot, `/fill ${C.x + dx} ${C.y} ${C.z + dz} ${C.x + dx} ${C.y + h - 1} ${C.z + dz} oak_log`, [C.x + dx, C.y + h - 1, C.z + dz], 'oak_log')

// Vérifie dans l'inventaire réel qu'on a gagné au moins 2 bûches
const gagne2 = (r, avant, apres) => {
    const delta = (apres.inventory.oak_log || 0) - (avant.inventory.oak_log || 0)
    return delta >= 2 || `oak_log +${delta}`
}

// Différentes "forêts" : [dx, dz, hauteur]
const FORETS = [
    [[3, 0, 2]],
    [[-6, 4, 1], [-6, 6, 1]],
    [[8, -8, 3]],
    [[0, 12, 5]],
    [[-10, -3, 4]],
    [[5, 5, 1], [-5, -5, 1]],
]

const nominaux = FORETS.map((foret) => ({
    nom: `forêt ${JSON.stringify(foret)}`,
    setup: async (bot) => { for (const [dx, dz, h] of foret) await colonne(bot, dx, dz, h) },
    args: { block: 'oak_log', count: 2 },
    verify: gagne2,
}))

// La bûche la plus proche est enfermée (inaccessible) : mine doit passer à la suivante
nominaux.push({
    nom: 'la plus proche est enfermée, une autre est accessible',
    setup: async (bot) => {
        await poser(bot, `/fill ${C.x + 2} ${C.y - 1} ${C.z - 1} ${C.x + 4} ${C.y + 1} ${C.z + 1} barrier hollow`, [C.x + 4, C.y + 1, C.z + 1], 'barrier')
        await poser(bot, `/setblock ${C.x + 3} ${C.y} ${C.z} oak_log`, [C.x + 3, C.y, C.z], 'oak_log')
        await colonne(bot, -10, 6, 2)
    },
    args: { block: 'oak_log', count: 2 },
    verify: gagne2,
})

const limites = [
    { nom: 'aucune bûche', args: { block: 'oak_log', count: 1 }, expect: 'block_not_found' },
    {
        nom: 'une seule bûche pour 2 demandées',
        setup: async (bot) => colonne(bot, 3, 0, 1),
        args: { block: 'oak_log', count: 2 },
        expect: 'partial',
    },
    { nom: 'count invalide', args: { block: 'oak_log', count: 0 }, expect: 'invalid_args' },
    {
        nom: 'pierre sans pioche',
        setup: (bot) => poser(bot, `/setblock ${C.x + 3} ${C.y} ${C.z} stone`, [C.x + 3, C.y, C.z], 'stone'),
        args: { block: 'stone', count: 1 },
        expect: 'no_tool',
    },
]

module.exports = { skill: 'mine', nominaux, limites }
