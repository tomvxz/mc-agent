const { goals } = require('mineflayer-pathfinder')
const { movementFailureReason, makeVec3, inventoryCounts, gainedSince, collectDrop } = require('./utils')

const NOTHING = ['air', 'cave_air', 'void_air', 'water', 'lava']

// Break the block at a position and pick up what drops (the bot walks there on its own)
async function break_block(bot, { x, y, z } = {}) {
    // 1. Check the arguments
    if (![x, y, z].every(Number.isInteger)) return { success: false, reason: 'invalid_args', details: { x, y, z } }
    const position = [x, y, z]
    const target = makeVec3(bot, x, y, z)

    // 2. What is at this position?
    const block = bot.blockAt(target)
    if (!block) return { success: false, reason: 'not_loaded', details: { position } }
    if (NOTHING.includes(block.name)) return { success: false, reason: 'nothing_to_break', details: { position, block: block.name } }
    if (!block.diggable) return { success: false, reason: 'unbreakable', details: { position, block: block.name } }

    // 3. Some blocks require a tool (stone needs a pickaxe), otherwise they drop nothing
    if (block.harvestTools && !bot.inventory.items().some((i) => block.harvestTools[i.type])) {
        const tools = Object.keys(block.harvestTools).map((id) => bot.registry.items[id].name)
        return { success: false, reason: 'no_tool', details: { position, block: block.name, tools } }
    }

    try {
        // 4. Get close enough to SEE and reach the block (useful for a block up high).
        // Being in range is not enough: otherwise the bot breaks through a wall and the item stays behind it.
        if (!bot.canDigBlock(block) || !bot.canSeeBlock(block)) {
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(target, bot.world))
        }
    } catch (e) {
        return { success: false, reason: movementFailureReason(e), details: { position, block: block.name, error: e.message } }
    }

    const before = inventoryCounts(bot)
    try {
        // 5. Take the best tool (none if bare hands are enough) and dig
        const tool = bot.pathfinder.bestHarvestTool(block)
        if (tool) await bot.equip(tool, 'hand')
        await bot.dig(bot.blockAt(target))
    } catch (e) {
        return { success: false, reason: 'dig_failed', details: { position, block: block.name, error: e.message } }
    }

    // 6. Check that the block is gone, then pick up what dropped
    const after = bot.blockAt(target)
    if (after && after.type === block.type) {
        return { success: false, reason: 'dig_failed', details: { position, block: block.name } }
    }
    await collectDrop(bot, target)
    // collected may be empty: leaves or glass often drop nothing
    return { success: true, reason: 'ok', details: { position, block: block.name, collected: gainedSince(bot, before) } }
}

module.exports = break_block
