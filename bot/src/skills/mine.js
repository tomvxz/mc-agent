// Shortcut: mine `count` blocks of a type = find + break_block, repeated.
// It is only an assembly of primitives (see CLAUDE.md, skill philosophy).
const find = require('./find')
const break_block = require('./break_block')
const { inventoryCounts, gainedSince } = require('./utils')

// Failures that only concern THIS block: try the next one
const TRY_ANOTHER = ['no_path', 'path_timeout', 'interrupted', 'nothing_to_break']
const MAX_ATTEMPTS = 20

async function mine(bot, { block, count = 1 } = {}) {
    // 1. Check the arguments
    if (!bot.registry.blocksByName[block]) return { success: false, reason: 'unknown_block', details: {} }
    if (!Number.isInteger(count) || count < 1) return { success: false, reason: 'invalid_args', details: { count } }

    const before = inventoryCounts(bot)
    const total = () => Object.values(gainedSince(bot, before)).reduce((a, b) => a + b, 0)
    const tried = new Set() // positions already attempted, so the same block is never targeted twice
    let dug = 0
    let unreachable = 0

    while (dug < count) {
        // 2. The nearest block not tried yet
        const found = await find(bot, { target: block, count: 50, max_distance: 32 })
        const target = found.success && found.details.matches.find((m) => !tried.has(`${m.x},${m.y},${m.z}`))
        if (!target || tried.size >= MAX_ATTEMPTS) {
            const reason = dug > 0 ? 'partial' : unreachable > 0 ? 'no_path' : 'block_not_found'
            return { success: false, reason, details: { dug, collected: gainedSince(bot, before), unreachable } }
        }
        tried.add(`${target.x},${target.y},${target.z}`)

        // 3. Break it (break_block walks there and picks up the drop)
        const r = await break_block(bot, { x: target.x, y: target.y, z: target.z })
        if (r.success) {
            dug++
        } else if (TRY_ANOTHER.includes(r.reason)) {
            unreachable++
        } else {
            // no_tool, unbreakable, dig_failed...: the next block would fail the same way
            return { success: false, reason: r.reason, details: { dug, collected: gainedSince(bot, before), ...r.details } }
        }
    }

    // 4. Breaking is not enough: something must have been collected per block
    if (total() < dug) return { success: false, reason: 'not_collected', details: { dug, collected: gainedSince(bot, before) } }
    return { success: true, reason: 'ok', details: { dug, collected: gainedSince(bot, before), unreachable } }
}

module.exports = mine
