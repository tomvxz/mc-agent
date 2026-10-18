const { goals } = require('mineflayer-pathfinder')
const { raisonDeplacement, vecteur } = require('./outils')

const VIDE = ['air', 'cave_air', 'void_air']
// Les 6 voisins d'un bloc : dessous, dessus, et les 4 côtés
const VOISINS = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

// Poser un bloc de l'inventaire à une position (le bot s'approche tout seul)
async function place_block(bot, { item, x, y, z } = {}) {
    // 1. Vérifier les arguments
    if (typeof item !== 'string' || ![x, y, z].every(Number.isInteger)) {
        return { success: false, reason: 'invalid_args', details: { item, x, y, z } }
    }
    if (!bot.registry.blocksByName[item]) return { success: false, reason: 'unknown_block', details: { item } }

    const objet = bot.inventory.items().find((i) => i.name === item)
    if (!objet) return { success: false, reason: 'not_in_inventory', details: { item } }

    // 2. La case visée doit être vide
    const position = [x, y, z]
    const cible = vecteur(bot, x, y, z)
    const actuel = bot.blockAt(cible)
    if (!actuel) return { success: false, reason: 'not_loaded', details: { position } }
    if (!VIDE.includes(actuel.name)) {
        return { success: false, reason: 'occupied', details: { position, current: actuel.name } }
    }

    // 3. Il faut un bloc plein à côté, sur lequel "coller" le nouveau bloc
    let appui = null
    let face = null
    for (const [dx, dy, dz] of VOISINS) {
        const voisin = bot.blockAt(cible.offset(dx, dy, dz))
        if (voisin && voisin.boundingBox === 'block') {
            appui = voisin
            face = vecteur(bot, -dx, -dy, -dz) // direction de l'appui vers la cible
            break
        }
    }
    if (!appui) return { success: false, reason: 'no_support', details: { position } }

    try {
        // 4. Se placer à portée, sans se tenir dans la case visée
        await bot.pathfinder.goto(new goals.GoalPlaceBlock(cible, bot.world, { range: 4 }))
    } catch (e) {
        return { success: false, reason: raisonDeplacement(e), details: { position, error: e.message } }
    }

    try {
        // 5. Prendre le bloc en main et le poser
        await bot.equip(objet, 'hand')
        await bot.placeBlock(appui, face)
    } catch (e) {
        return { success: false, reason: 'place_failed', details: { position, error: e.message } }
    }

    // 6. Vérifier que le bloc est bien là
    const pose = bot.blockAt(cible)
    if (!pose || pose.name !== item) {
        return { success: false, reason: 'place_failed', details: { position, current: pose && pose.name } }
    }
    return { success: true, reason: 'ok', details: { position } }
}

module.exports = place_block
