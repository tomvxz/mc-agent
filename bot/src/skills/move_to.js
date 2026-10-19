const { goals } = require('mineflayer-pathfinder')
const { movementFailureReason, makeVec3, round1, trackWorldChanges } = require('./utils')

// Go to a position. The pathfinder deals with obstacles on its own (see src/movements.js):
// it jumps, digs a passage, pillars up with dirt, avoids lava.
async function move_to(bot, { x, y, z, range = 1 } = {}) {
    // 1. Coordinates must be numbers
    if (![x, y, z, range].every(Number.isFinite) || range < 0) {
        return { success: false, reason: 'invalid_args', details: { x, y, z, range } }
    }

    const target = [x, y, z]
    const stopTracking = trackWorldChanges(bot)
    // Where are we relative to the target, and what did we change on the way?
    const summary = () => {
        const p = bot.entity.position
        return {
            target,
            position: [p.x, p.y, p.z].map(round1),
            distance: round1(p.distanceTo(makeVec3(bot, x, y, z))),
            ...stopTracking(),
        }
    }

    try {
        // 2. Walk until within `range` blocks of the target
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
    } catch (e) {
        return { success: false, reason: movementFailureReason(e), details: { ...summary(), error: e.message } }
    }

    // 3. Check that we really arrived (+1 because the pathfinder counts in whole blocks)
    const arrival = summary()
    if (arrival.distance > range + 1) return { success: false, reason: 'not_arrived', details: arrival }
    return { success: true, reason: 'ok', details: arrival }
}

module.exports = move_to
