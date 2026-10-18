const { attendreQue } = require('./outils')

// Nourritures qu'on ne choisit jamais toute seule (poison, téléportation...)
const A_EVITER = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew']

async function eat(bot, { food } = {}) {
    const aliments = bot.registry.foodsByName

    // 1. Si un aliment est demandé, il doit exister
    if (food !== undefined) {
        if (typeof food !== 'string') return { success: false, reason: 'invalid_args', details: { food } }
        if (!aliments[food]) return { success: false, reason: 'unknown_item', details: { food } }
    }

    // 2. Impossible de manger quand la barre de faim est pleine
    const avant = bot.food
    if (avant >= 20) return { success: false, reason: 'not_hungry', details: { food_before: avant } }

    // 3. Choisir dans l'inventaire : l'aliment demandé, sinon le plus nourrissant
    const candidats = bot.inventory.items().filter((i) =>
        food ? i.name === food : aliments[i.name] && !A_EVITER.includes(i.name)
    )
    if (candidats.length === 0) return { success: false, reason: 'no_food', details: { food, food_before: avant } }
    candidats.sort((a, b) => aliments[b.name].effectiveQuality - aliments[a.name].effectiveQuality)
    const choix = candidats[0]

    try {
        // 4. Le prendre en main et le manger
        await bot.equip(choix, 'hand')
        await bot.consume()
    } catch (e) {
        return { success: false, reason: 'eat_failed', details: { food: choix.name, food_before: avant, error: e.message } }
    }

    // 5. Vérifier que la faim est vraiment remontée (le serveur peut répondre un peu après)
    await attendreQue(() => bot.food > avant, 1000)
    if (bot.food <= avant) {
        return { success: false, reason: 'eat_failed', details: { food: choix.name, food_before: avant, food_after: bot.food } }
    }
    return { success: true, reason: 'ok', details: { food: choix.name, food_before: avant, food_after: bot.food } }
}

module.exports = eat
