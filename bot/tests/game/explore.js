const { placeAndWait, MIN, MAX, CENTER: C } = require('./arena')

const DISTANCE = 15 // the arena is 45 wide: stay inside it
// North = -z, east = +x
const HEADINGS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], north_east: [1, -1] }

const nominal = Object.entries(HEADINGS).map(([direction, [dx, dz]]) => ({
    name: direction,
    args: { direction, distance: DISTANCE },
    // We really moved in the right direction, by at least 12 blocks
    verify: (r, before, after, bot) => {
        const p = bot.entity.position
        const n = Math.hypot(dx, dz)
        const progress = ((p.x - (C.x + 0.5)) * dx + (p.z - (C.z + 0.5)) * dz) / n
        return progress >= DISTANCE - 3 || `only ${progress.toFixed(1)} blocks towards ${direction}`
    },
}))

const edgeCases = [
    {
        name: 'blocked to the north by an unbreakable wall',
        setup: (bot) => placeAndWait(bot, `/fill ${MIN.x + 1} ${C.y} ${C.z - 5} ${MAX.x - 1} ${MAX.y - 1} ${C.z - 5} barrier`, [C.x, C.y, C.z - 5], 'barrier'),
        args: { direction: 'north', distance: DISTANCE },
        expect: 'no_path',
    },
    { name: 'unknown direction', args: { direction: 'up' }, expect: 'invalid_args' },
]

module.exports = { skill: 'explore', nominal, edgeCases }
