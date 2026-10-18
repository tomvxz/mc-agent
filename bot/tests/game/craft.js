const { poser, donner: donnerObjet, CENTRE: C } = require('./arena')

// Donne une liste d'objets : { oak_log: 3 }
const donner = (objets) => async (bot) => {
    for (const [nom, n] of Object.entries(objets)) await donnerObjet(bot, nom, n)
}

// Vérifie dans l'inventaire réel qu'on a gagné au moins n objets
const gagne = (nom, n) => (r, avant, apres) => {
    const delta = (apres.inventory[nom] || 0) - (avant.inventory[nom] || 0)
    return delta >= n || `${nom} +${delta}`
}

const nominaux = [
    { nom: 'planches (2x2)', setup: donner({ oak_log: 1 }), args: { item: 'oak_planks', count: 4 }, verify: gagne('oak_planks', 4) },
    { nom: 'bâtons (2x2)', setup: donner({ oak_planks: 2 }), args: { item: 'stick', count: 4 }, verify: gagne('stick', 4) },
    { nom: 'table (2x2)', setup: donner({ oak_planks: 4 }), args: { item: 'crafting_table' }, verify: gagne('crafting_table', 1) },
    {
        nom: 'pioche en bois (3x3, table à 6 blocs)',
        setup: async (bot) => {
            await donner({ oak_planks: 3, stick: 2 })(bot)
            await poser(bot, `/setblock ${C.x + 6} ${C.y} ${C.z + 2} crafting_table`, [C.x + 6, C.y, C.z + 2], 'crafting_table')
        },
        args: { item: 'wooden_pickaxe' },
        verify: gagne('wooden_pickaxe', 1),
    },
]

const limites = [
    { nom: 'ingrédients manquants', args: { item: 'stick' }, expect: 'missing_ingredients' },
    { nom: 'pas de table autour', setup: donner({ oak_planks: 3, stick: 2 }), args: { item: 'wooden_pickaxe' }, expect: 'no_crafting_table' },
    { nom: 'objet sans recette', args: { item: 'dirt' }, expect: 'no_recipe' },
    { nom: 'objet inconnu', args: { item: 'truc' }, expect: 'unknown_item' },
]

module.exports = { skill: 'craft', nominaux, limites }
