const { cmd, donner } = require('./arena')
const { attendreQue } = require('../../src/skills/outils')

// Fait baisser la faim avec l'effet "faim" très fort, jusqu'à 17 ou moins
async function affamer(bot) {
    const u = bot.username
    await cmd(bot, `/effect give ${u} hunger 20 255 true`)
    const ok = await attendreQue(() => bot.food <= 17, 20000)
    await cmd(bot, `/effect clear ${u} hunger`)
    if (!ok) throw new Error('la faim ne baisse pas') // mise en place ratée
}

// Vérifie que la faim est remontée et qu'un aliment a bien disparu de l'inventaire
const aMange = (nom) => (r, avant, apres, bot) => {
    if (bot.food <= avant.food) return `faim ${avant.food} -> ${bot.food}`
    const delta = (avant.inventory[nom] || 0) - (apres.inventory[nom] || 0)
    return delta === 1 || `${nom} -${delta}`
}

const nominaux = [
    {
        nom: 'pain, aliment non précisé',
        setup: async (bot) => { await donner(bot, 'bread', 3); return affamer(bot) },
        args: {},
        verify: aMange('bread'),
    },
    {
        nom: 'pomme demandée',
        setup: async (bot) => { await donner(bot, 'apple', 2); return affamer(bot) },
        args: { food: 'apple' },
        verify: aMange('apple'),
    },
    {
        nom: 'choisit le steak plutôt que la chair putréfiée',
        setup: async (bot) => {
            await donner(bot, 'rotten_flesh', 5)
            await donner(bot, 'cooked_beef', 1)
            return affamer(bot)
        },
        args: {},
        verify: aMange('cooked_beef'),
    },
]

const limites = [
    { nom: 'pas faim', setup: (bot) => donner(bot, 'bread', 3), args: {}, expect: 'not_hungry' },
    { nom: 'rien à manger', setup: affamer, args: {}, expect: 'no_food' },
    { nom: 'aliment inconnu', args: { food: 'diamond' }, expect: 'unknown_item' },
]

module.exports = { skill: 'eat', nominaux, limites }
