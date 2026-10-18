const { poser, donner: donnerObjet, CENTRE: C } = require('./arena')

const donner = (bot) => donnerObjet(bot, 'cobblestone', 5)

// Vérifie dans le monde réel que le bloc est posé
const estPose = (x, y, z) => (r, avant, apres, bot) => {
    const b = bot.blockAt(bot.entity.position.clone().set(x, y, z))
    return (b && b.name === 'cobblestone') || `bloc trouvé : ${b && b.name}`
}

// Positions sur le sol : à côté du bot, puis de plus en plus loin (il faut marcher)
const POSITIONS = [[1, 0], [0, -2], [-6, 3], [8, 8], [-12, -4], [15, -10]]

const nominaux = POSITIONS.map(([dx, dz]) => {
    const [x, y, z] = [C.x + dx, C.y, C.z + dz]
    return { nom: `sol ${dx},${dz}`, setup: donner, args: { item: 'cobblestone', x, y, z }, verify: estPose(x, y, z) }
})

// Sur un bloc existant (appui par en dessous, à hauteur des yeux)
nominaux.push({
    nom: 'sur un bloc',
    setup: async (bot) => { await donner(bot); await poser(bot, `/setblock ${C.x + 4} ${C.y} ${C.z + 4} stone`, [C.x + 4, C.y, C.z + 4], 'stone') },
    args: { item: 'cobblestone', x: C.x + 4, y: C.y + 1, z: C.z + 4 },
    verify: estPose(C.x + 4, C.y + 1, C.z + 4),
})

const limites = [
    {
        nom: 'case occupée',
        setup: async (bot) => { await donner(bot); await poser(bot, `/setblock ${C.x + 3} ${C.y} ${C.z} stone`, [C.x + 3, C.y, C.z], 'stone') },
        args: { item: 'cobblestone', x: C.x + 3, y: C.y, z: C.z },
        expect: 'occupied',
    },
    { nom: 'pas dans l\'inventaire', args: { item: 'cobblestone', x: C.x + 3, y: C.y, z: C.z }, expect: 'not_in_inventory' },
    { nom: 'en l\'air, sans appui', setup: donner, args: { item: 'cobblestone', x: C.x + 3, y: C.y + 4, z: C.z }, expect: 'no_support' },
]

module.exports = { skill: 'place_block', nominaux, limites }
