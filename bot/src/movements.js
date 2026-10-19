const { Movements } = require('mineflayer-pathfinder')
const { isHostile } = require('./state')

// Pathfinder movement settings.
// Principle: the LLM decides WHERE to go, the pathfinder decides HOW to get past obstacles
// (jump, dig, pillar up, open a door). We add instincts so that these abilities do not kill
// the bot or break things that matter.

// Bug fix: the pathfinder accepts a diagonal move as soon as ONE of the two sides is free;
// the bot then brushes the block's corner and gets stuck against it (seen in move_to tests).
// So we require BOTH sides to be free.
class NoCornerCutMovements extends Movements {
    getMoveDiagonal(node, dir, neighbors) {
        // y = 1 if the diagonal steps up one block
        const y = this.getBlock(node, dir.x, 0, dir.z).physical ? 1 : 0
        for (const [dx, dz] of [[dir.x, 0], [0, dir.z]]) {
            // Feet and head must fit on each side
            if (!this.getBlock(node, dx, y, dz).safe || !this.getBlock(node, dx, y + 1, dz).safe) return
        }
        super.getMoveDiagonal(node, dir, neighbors)
    }
}

// Blocks never to walk through (lava, fire and cobwebs are already avoided by default)
const AVOID = ['soul_fire', 'cactus', 'sweet_berry_bush', 'powder_snow', 'wither_rose']
// Blocks never to stand on (they burn)
const DANGEROUS_FLOOR = ['magma_block', 'campfire', 'soul_campfire']
// Useful blocks never to break on the way
// (+ every bed, door and fence gate, added below)
const PROTECTED = ['chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker',
    'crafting_table', 'anvil', 'enchanting_table']
// "Throwaway" blocks the pathfinder may place to pillar up or bridge
const SCAFFOLDING_BLOCKS = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack']

const HOSTILE_DISTANCE = 4 // cells closer than this to a monster cost more
const HOSTILE_COST = 20

function create(bot) {
    const r = bot.registry
    const m = new NoCornerCutMovements(bot)

    // Abilities: keep the pathfinder's own (parkour, sprint, digging, pillaring) and tune them
    m.canDig = true
    m.digCost = 2 // digging has a cost: it prefers going around a small obstacle
    m.allow1by1towers = true
    m.placeCost = 2
    m.scafoldingBlocks = SCAFFOLDING_BLOCKS.map((n) => r.itemsByName[n].id)
    // No door opening: in this pathfinder version the option only handles fence gates, and even
    // then, in tests, it broke the gate or got stuck in front of it while reporting arrival.
    // A closed door therefore gives no_path; opening it will be use_item's job (batch 2).
    m.canOpenDoors = false

    // Instincts
    m.liquidCost = 3 // water costs more: go around it when possible
    m.maxDropDown = 3 // no fall higher than 3 blocks (no damage)
    for (const n of AVOID) m.blocksToAvoid.add(r.blocksByName[n].id)
    for (const n of PROTECTED) m.blocksCantBreak.add(r.blocksByName[n].id)
    for (const n of Object.keys(r.blocksByName)) {
        if (n.endsWith('_bed') || n.endsWith('_door') || n.endsWith('_fence_gate')) m.blocksCantBreak.add(r.blocksByName[n].id)
    }
    const dangerousFloor = new Set(DANGEROUS_FLOOR.map((n) => r.blocksByName[n].id))

    // Monster positions, recomputed at most once per second (the pathfinder calls this
    // function for every cell it considers: it has to be fast)
    let hostiles = []
    let hostilesTime = 0
    const hostilePositions = () => {
        if (Date.now() - hostilesTime > 1000) {
            hostiles = Object.values(bot.entities).filter((e) => isHostile(e) && e.position).map((e) => e.position)
            hostilesTime = Date.now()
        }
        return hostiles
    }

    // Extra cost for stepping onto a cell
    m.exclusionAreasStep.push((block) => {
        const p = block.position
        const below = bot.blockAt(p.offset(0, -1, 0))
        if (below && dangerousFloor.has(below.type)) return 100 // 100 = forbidden
        for (const pos of hostilePositions()) {
            if (pos.distanceTo(p) < HOSTILE_DISTANCE) return HOSTILE_COST
        }
        return 0
    })
    return m
}

// One settings object per bot, created once (building it walks every block of the game)
const cache = new WeakMap()
function getMovements(bot) {
    if (!cache.has(bot)) cache.set(bot, create(bot))
    return cache.get(bot)
}

module.exports = { getMovements, NoCornerCutMovements, SCAFFOLDING_BLOCKS }
