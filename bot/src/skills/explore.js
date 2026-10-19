const { goals } = require('mineflayer-pathfinder')
const { movementFailureReason, round1, trackWorldChanges } = require('./utils')

// In Minecraft, north is towards -z and east towards +x
const DIRECTIONS = {
    north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
    north_east: [1, -1], north_west: [-1, -1], south_east: [1, 1], south_west: [-1, 1],
}

// Head in a direction to discover new places (when find finds nothing).
// The arrival height is unknown: only x and z are targeted.
async function explore(bot, { direction, distance = 32 } = {}) {
    if (!DIRECTIONS[direction] || !Number.isFinite(distance) || distance <= 0 || distance > 256) {
        return { success: false, reason: 'invalid_args', details: { direction, distance, directions: Object.keys(DIRECTIONS) } }
    }

    // 1. The target point, `distance` blocks away (diagonals are divided by √2 to keep the distance)
    const [dx, dz] = DIRECTIONS[direction]
    const n = Math.hypot(dx, dz)
    // (start from the bot's block: rounding 1000.5 would always shift the target the same way)
    const start = bot.entity.position.clone()
    const x = Math.floor(start.x) + Math.round((dx / n) * distance)
    const z = Math.floor(start.z) + Math.round((dz / n) * distance)

    const stopTracking = trackWorldChanges(bot)
    const summary = () => {
        const p = bot.entity.position
        return {
            direction,
            start: [start.x, start.y, start.z].map(round1),
            end: [p.x, p.y, p.z].map(round1),
            traveled: round1(Math.hypot(p.x - start.x, p.z - start.z)), // horizontal distance
            ...stopTracking(),
        }
    }

    try {
        // 2. Go there (within 1 block)
        await bot.pathfinder.goto(new goals.GoalNearXZ(x, z, 1))
    } catch (e) {
        return { success: false, reason: movementFailureReason(e), details: { ...summary(), error: e.message } }
    }
    return { success: true, reason: 'ok', details: summary() }
}

module.exports = explore
