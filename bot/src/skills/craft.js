const move_to = require('./move_to')
const { waitUntil } = require('./utils')

async function craft(bot, { item, count = 1 } = {}) {
    // 1. Check the arguments
    if (typeof item !== 'string' || !Number.isInteger(count) || count < 1) {
        return { success: false, reason: 'invalid_args', details: { item, count } }
    }
    const info = bot.registry.itemsByName[item]
    if (!info) return { success: false, reason: 'unknown_item', details: { item } }

    // 2. Does this item have a recipe at all? (true = "assuming we have a table")
    if (bot.recipesAll(info.id, null, true).length === 0) {
        return { success: false, reason: 'no_recipe', details: { item } }
    }

    // 3. A recipe doable with the inventory, first without a table (2x2 grid)
    let table = null
    let recipes = bot.recipesFor(info.id, null, count, null)
    if (recipes.length === 0) {
        // Otherwise with a table (3x3 grid): do we have the ingredients?
        recipes = bot.recipesFor(info.id, null, count, true)
        if (recipes.length === 0) return { success: false, reason: 'missing_ingredients', details: { item, count } }

        table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 })
        if (!table) return { success: false, reason: 'no_crafting_table', details: { item } }

        // Walk to the table with the move_to skill
        const p = table.position
        const walk = await move_to(bot, { x: p.x, y: p.y, z: p.z, range: 3 })
        if (!walk.success) return { success: false, reason: walk.reason, details: { item, ...walk.details } }
    }

    // 4. Craft: a recipe sometimes yields several items (1 log = 4 planks)
    const recipe = recipes[0]
    const times = Math.ceil(count / recipe.result.count)
    const before = bot.inventory.count(info.id, null)
    const crafted = () => bot.inventory.count(info.id, null) - before
    try {
        await bot.craft(recipe, times, table)
    } catch (e) {
        return { success: false, reason: 'craft_failed', details: { item, error: e.message } }
    }

    // 5. Check the inventory (the update arrives a little later)
    if (!(await waitUntil(() => crafted() >= count, 1000))) {
        return { success: false, reason: 'craft_failed', details: { item, crafted: crafted() } }
    }
    return { success: true, reason: 'ok', details: { item, crafted: crafted() } }
}

module.exports = craft
