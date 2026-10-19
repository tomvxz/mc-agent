// Small helpers shared by several skills (this is not a skill)
const { goals } = require('mineflayer-pathfinder')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait until condition() becomes true, at most maxMs. Returns true if it happened.
async function waitUntil(condition, maxMs) {
    const end = Date.now() + maxMs
    while (Date.now() < end) {
        if (condition()) return true
        await sleep(50)
    }
    return condition()
}

// Turn a pathfinder error into a readable failure reason
function movementFailureReason(e) {
    if (e.name === 'NoPath') return 'no_path'
    if (e.name === 'Timeout') return 'path_timeout' // it thought for too long
    if (e.name === 'GoalChanged' || e.name === 'PathStopped') return 'interrupted'
    return 'exception'
}

// Build a Vec3 (Mineflayer's 3D vector) by copying the bot's position and changing x, y, z
function makeVec3(bot, x, y, z) {
    return bot.entity.position.clone().set(x, y, z)
}

// Round to one decimal, for readable details
const round1 = (v) => Math.round(v * 10) / 10

// Inventory as { name: count }
function inventoryCounts(bot) {
    const inv = {}
    for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count
    return inv
}

// What was gained since `before` (only counts that went up): { oak_log: 2 }
function gainedSince(bot, before) {
    const gains = {}
    for (const [name, n] of Object.entries(inventoryCounts(bot))) {
        if (n > (before[name] || 0)) gains[name] = n - (before[name] || 0)
    }
    return gains
}

// Count the blocks placed and broken by the bot during a move
// (the pathfinder pillars up, bridges and digs passages on its own).
// Placed = scaffolding blocks consumed from the inventory (while moving, only the
// pathfinder places any; Mineflayer's blockPlaced event is not always emitted).
function trackWorldChanges(bot) {
    const { SCAFFOLDING_BLOCKS } = require('../movements')
    const scaffolding = () => SCAFFOLDING_BLOCKS.reduce((n, name) => n + (inventoryCounts(bot)[name] || 0), 0)
    const before = scaffolding()
    let broken = 0
    const onBroken = () => broken++
    bot.on('diggingCompleted', onBroken)
    return () => {
        bot.removeListener('diggingCompleted', onBroken)
        return { blocks_placed: Math.max(0, before - scaffolding()), blocks_broken: broken }
    }
}

// After a block is broken, its item drops on the ground: go and pick it up
async function collectDrop(bot, p) {
    const droppedItem = () => Object.values(bot.entities).find((e) => e.name === 'item' && e.position.distanceTo(p) < 3)
    await waitUntil(droppedItem, 1000) // the item appears shortly after the block breaks
    const item = droppedItem()
    if (!item) return
    try {
        // Wait for it to land, then get within 1 block (pickup works at that distance;
        // aiming for 0 makes the pathfinder break the blocks above to stand there)
        await sleep(500)
        const o = item.position
        await bot.pathfinder.goto(new goals.GoalNear(o.x, o.y, o.z, 1))
    } catch (e) {
        return // not a problem here: the "collected" summary will show the item is missing
    }
    const pickedUp = () => !bot.entities[item.id] // picked up = the entity disappears
    if (await waitUntil(pickedUp, 500)) return

    // Still there: look at it and walk straight towards it (at most 1 s)
    await bot.lookAt(item.position, true)
    bot.setControlState('forward', true)
    await waitUntil(pickedUp, 1000)
    bot.setControlState('forward', false)
}

module.exports = {
    sleep, waitUntil, movementFailureReason, makeVec3, round1,
    inventoryCounts, gainedSince, trackWorldChanges, collectDrop,
}
