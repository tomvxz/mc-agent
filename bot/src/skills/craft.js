const move_to = require('./move_to')
const { attendreQue } = require('./outils')

async function craft(bot, { item, count = 1 } = {}) {
    // 1. Vérifier les arguments
    if (typeof item !== 'string' || !Number.isInteger(count) || count < 1) {
        return { success: false, reason: 'invalid_args', details: { item, count } }
    }
    const info = bot.registry.itemsByName[item]
    if (!info) return { success: false, reason: 'unknown_item', details: { item } }

    // 2. Cet objet a-t-il une recette ? (true = "en supposant qu'on a une table")
    if (bot.recipesAll(info.id, null, true).length === 0) {
        return { success: false, reason: 'no_recipe', details: { item } }
    }

    // 3. Une recette faisable avec l'inventaire, d'abord sans table (grille 2x2)
    let table = null
    let recettes = bot.recipesFor(info.id, null, count, null)
    if (recettes.length === 0) {
        // Sinon avec une table (grille 3x3) : a-t-on les ingrédients ?
        recettes = bot.recipesFor(info.id, null, count, true)
        if (recettes.length === 0) return { success: false, reason: 'missing_ingredients', details: { item, count } }

        table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 })
        if (!table) return { success: false, reason: 'no_crafting_table', details: { item } }

        // Aller près de la table, avec la compétence move_to
        const p = table.position
        const aller = await move_to(bot, { x: p.x, y: p.y, z: p.z, range: 3 })
        if (!aller.success) return { success: false, reason: aller.reason, details: { item, ...aller.details } }
    }

    // 4. Fabriquer : une recette donne parfois plusieurs objets (1 bûche = 4 planches)
    const recette = recettes[0]
    const fois = Math.ceil(count / recette.result.count)
    const avant = bot.inventory.count(info.id, null)
    const crafted = () => bot.inventory.count(info.id, null) - avant
    try {
        await bot.craft(recette, fois, table)
    } catch (e) {
        return { success: false, reason: 'craft_failed', details: { item, error: e.message } }
    }

    // 5. Vérifier dans l'inventaire (la mise à jour arrive un peu après)
    if (!(await attendreQue(() => crafted() >= count, 1000))) {
        return { success: false, reason: 'craft_failed', details: { item, crafted: crafted() } }
    }
    return { success: true, reason: 'ok', details: { item, crafted: crafted() } }
}

module.exports = craft
