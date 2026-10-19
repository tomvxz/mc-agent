const { placeAndWait, giveAndWait, CENTER: C } = require('./arena')

const blockAt = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z))

// Check that the block is gone AND that the expected item reached the inventory
const brokenAndCollected = ([x, y, z], item) => (r, before, after, bot) => {
    const b = blockAt(bot, x, y, z)
    if (b && b.name !== 'air') return `the block is still there (${b.name})`
    const delta = (after.inventory[item] || 0) - (before.inventory[item] || 0)
    return delta >= 1 || `${item} +${delta}`
}

// [name, position, block placed, expected item, extra setup]
const CASES = [
    ['log on the ground', [C.x + 3, C.y, C.z], 'oak_log', 'oak_log'],
    ['log up high (y+3, floating: the item falls to the ground)', [C.x - 4, C.y + 3, C.z + 2], 'oak_log', 'oak_log'],
    ['dirt', [C.x + 6, C.y, C.z - 6], 'dirt', 'dirt'],
    ['stone with a pickaxe', [C.x - 8, C.y, C.z - 3], 'stone', 'cobblestone', 'pickaxe'],
]

const nominal = CASES.map(([name, [x, y, z], material, item, extra]) => ({
    name,
    setup: async (bot) => {
        await placeAndWait(bot, `/setblock ${x} ${y} ${z} ${material}`, [x, y, z], material)
        if (extra === 'pickaxe') await giveAndWait(bot, 'wooden_pickaxe', 1)
    },
    args: { x, y, z },
    verify: brokenAndCollected([x, y, z], item),
}))

const P = [C.x + 3, C.y, C.z]
const H = [C.x - 4, C.y + 3, C.z + 2]
const edgeCases = [
    {
        // The item falls back ONTO the column, out of reach: broken (ok) but collected is empty
        name: 'top of a column (item out of reach)',
        setup: (bot) => placeAndWait(bot, `/fill ${H[0]} ${C.y} ${H[2]} ${H[0]} ${H[1]} ${H[2]} oak_log`, H, 'oak_log'),
        args: { x: H[0], y: H[1], z: H[2] },
        expect: 'ok',
    },
    { name: 'nothing to break (air)', args: { x: P[0], y: P[1], z: P[2] }, expect: 'nothing_to_break' },
    {
        name: 'unbreakable barrier',
        setup: (bot) => placeAndWait(bot, `/setblock ${P.join(' ')} barrier`, P, 'barrier'),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: 'unbreakable',
    },
    {
        name: 'stone without a pickaxe',
        setup: (bot) => placeAndWait(bot, `/setblock ${P.join(' ')} stone`, P, 'stone'),
        args: { x: P[0], y: P[1], z: P[2] },
        expect: 'no_tool',
    },
]

module.exports = { skill: 'break_block', nominal, edgeCases }
