const { goals } = require('mineflayer-pathfinder')
const { raisonDeplacement, vecteur, inventaire, gagne, ramasser } = require('./outils')

const RIEN = ['air', 'cave_air', 'void_air', 'water', 'lava']

// Casser le bloc à une position et ramasser ce qui tombe (le bot s'approche tout seul)
async function break_block(bot, { x, y, z } = {}) {
    // 1. Vérifier les arguments
    if (![x, y, z].every(Number.isInteger)) return { success: false, reason: 'invalid_args', details: { x, y, z } }
    const position = [x, y, z]
    const cible = vecteur(bot, x, y, z)

    // 2. Que y a-t-il à cette position ?
    const bloc = bot.blockAt(cible)
    if (!bloc) return { success: false, reason: 'not_loaded', details: { position } }
    if (RIEN.includes(bloc.name)) return { success: false, reason: 'nothing_to_break', details: { position, block: bloc.name } }
    if (!bloc.diggable) return { success: false, reason: 'unbreakable', details: { position, block: bloc.name } }

    // 3. Certains blocs exigent un outil (la pierre une pioche), sinon ils ne donnent rien
    if (bloc.harvestTools && !bot.inventory.items().some((i) => bloc.harvestTools[i.type])) {
        const outils = Object.keys(bloc.harvestTools).map((id) => bot.registry.items[id].name)
        return { success: false, reason: 'no_tool', details: { position, block: bloc.name, tools: outils } }
    }

    try {
        // 4. S'approcher jusqu'à VOIR et atteindre le bloc (utile pour un bloc en hauteur).
        // Être à portée ne suffit pas : sinon le bot casse à travers un mur, et l'objet reste derrière.
        if (!bot.canDigBlock(bloc) || !bot.canSeeBlock(bloc)) {
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(cible, bot.world))
        }
    } catch (e) {
        return { success: false, reason: raisonDeplacement(e), details: { position, block: bloc.name, error: e.message } }
    }

    const avant = inventaire(bot)
    try {
        // 5. Prendre le meilleur outil (rien si la main suffit) et casser
        const outil = bot.pathfinder.bestHarvestTool(bloc)
        if (outil) await bot.equip(outil, 'hand')
        await bot.dig(bot.blockAt(cible))
    } catch (e) {
        return { success: false, reason: 'dig_failed', details: { position, block: bloc.name, error: e.message } }
    }

    // 6. Vérifier que le bloc a disparu, puis ramasser ce qui est tombé
    const apres = bot.blockAt(cible)
    if (apres && apres.type === bloc.type) {
        return { success: false, reason: 'dig_failed', details: { position, block: bloc.name } }
    }
    await ramasser(bot, cible)
    // collected peut être vide : des feuilles ou du verre ne donnent souvent rien
    return { success: true, reason: 'ok', details: { position, block: bloc.name, collected: gagne(bot, avant) } }
}

module.exports = break_block
