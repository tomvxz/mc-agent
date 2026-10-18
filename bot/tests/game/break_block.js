const { poser, donner, CENTRE: C } = require('./arena')

const bloc = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z))

// Vérifie que le bloc a disparu ET que l'objet attendu est arrivé dans l'inventaire
const casseEtRamasse = ([x, y, z], objet) => (r, avant, apres, bot) => {
    const b = bloc(bot, x, y, z)
    if (b && b.name !== 'air') return `le bloc est toujours là (${b.name})`
    const delta = (apres.inventory[objet] || 0) - (avant.inventory[objet] || 0)
    return delta >= 1 || `${objet} +${delta}`
}

// [nom, position, bloc posé, objet attendu, mise en place en plus]
const CAS = [
    ['bûche au sol', [C.x + 3, C.y, C.z], 'oak_log', 'oak_log'],
    ['bûche en hauteur (y+3, dans le vide : l\'objet tombe au sol)', [C.x - 4, C.y + 3, C.z + 2], 'oak_log', 'oak_log'],
    ['terre', [C.x + 6, C.y, C.z - 6], 'dirt', 'dirt'],
    ['pierre avec une pioche', [C.x - 8, C.y, C.z - 3], 'stone', 'cobblestone', 'pioche'],
]

const nominaux = CAS.map(([nom, [x, y, z], matiere, objet, extra]) => ({
    nom,
    setup: async (bot) => {
        await poser(bot, `/setblock ${x} ${y} ${z} ${matiere}`, [x, y, z], matiere)
        if (extra === 'pioche') await donner(bot, 'wooden_pickaxe', 1)
    },
    args: { x, y, z },
    verify: casseEtRamasse([x, y, z], objet),
}))

const P = [C.x + 3, C.y, C.z]
const H = [C.x - 4, C.y + 3, C.z + 2]
const limites = [
    {
        // L'objet retombe SUR la colonne, hors de portée : cassé (ok) mais collected est vide
        nom: 'sommet d\'une colonne (objet inatteignable)',
        setup: (bot) => poser(bot, `/fill ${H[0]} ${C.y} ${H[2]} ${H[0]} ${H[1]} ${H[2]} oak_log`, H, 'oak_log'),
        args: { x: H[0], y: H[1], z: H[2] },
        expect: 'ok',
    },
    { nom: 'rien à casser (air)', args: { x: P[0], y: P[1], z: P[2] }, expect: 'nothing_to_break' },
    {
        nom: 'barrière incassable',
        setup: (bot) => poser(bot, `/setblock ${P.join(' ')} barrier`, P, 'barrier'),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: 'unbreakable',
    },
    {
        nom: 'pierre sans pioche',
        setup: (bot) => poser(bot, `/setblock ${P.join(' ')} stone`, P, 'stone'),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: 'no_tool',
    },
]

module.exports = { skill: 'break_block', nominaux, limites }
