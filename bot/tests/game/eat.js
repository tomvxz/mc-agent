const { runCommand, giveAndWait } = require('./arena')
const { waitUntil } = require('../../src/skills/utils')

// Lower hunger with a very strong "hunger" effect, down to 17 or less
async function starve(bot) {
    const u = bot.username
    await runCommand(bot, `/effect give ${u} hunger 20 255 true`)
    const ok = await waitUntil(() => bot.food <= 17, 20000)
    await runCommand(bot, `/effect clear ${u} hunger`)
    if (!ok) throw new Error('hunger does not go down') // setup failed
}

// Check that hunger went up and that one food item left the inventory
const ate = (name) => (r, before, after, bot) => {
    if (bot.food <= before.food) return `food ${before.food} -> ${bot.food}`
    const delta = (before.inventory[name] || 0) - (after.inventory[name] || 0)
    return delta === 1 || `${name} -${delta}`
}

const nominal = [
    {
        name: 'bread, no food specified',
        setup: async (bot) => { await giveAndWait(bot, 'bread', 3); return starve(bot) },
        args: {},
        verify: ate('bread'),
    },
    {
        name: 'apple requested',
        setup: async (bot) => { await giveAndWait(bot, 'apple', 2); return starve(bot) },
        args: { food: 'apple' },
        verify: ate('apple'),
    },
    {
        name: 'picks the steak over rotten flesh',
        setup: async (bot) => {
            await giveAndWait(bot, 'rotten_flesh', 5)
            await giveAndWait(bot, 'cooked_beef', 1)
            return starve(bot)
        },
        args: {},
        verify: ate('cooked_beef'),
    },
]

const edgeCases = [
    { name: 'not hungry', setup: (bot) => giveAndWait(bot, 'bread', 3), args: {}, expect: 'not_hungry' },
    { name: 'nothing to eat', setup: starve, args: {}, expect: 'no_food' },
    { name: 'unknown food', args: { food: 'diamond' }, expect: 'unknown_item' },
]

module.exports = { skill: 'eat', nominal, edgeCases }
