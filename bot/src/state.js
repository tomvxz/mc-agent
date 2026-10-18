// Slime, phantom... ont le type 'mob' et pas 'hostile' : on les ajoute à la main
const AUTRES_HOSTILES = ['slime', 'magma_cube', 'phantom', 'ghast', 'shulker', 'ender_dragon']

function isHostile(e) {
    return e.type === 'hostile' || AUTRES_HOSTILES.includes(e.name)
}

function observe(bot) {
    // Inventaire : { oak_log: 3, dirt: 12 }
    const inventory = {}
    for (const item of bot.inventory.items()) {
        inventory[item.name] = (inventory[item.name] || 0) + item.count
    }

    // Monstres à moins de 24 blocs
    const pos = bot.entity.position
    const hostiles = Object.values(bot.entities).filter(
        (e) => isHostile(e) && e.position && e.position.distanceTo(pos) < 24
    )

    // Quelques blocs utiles autour (rayon 8)
    const blocks_nearby = {}
    for (const nom of ['oak_log', 'stone', 'coal_ore', 'iron_ore', 'water', 'lava']) {
        const info = bot.registry.blocksByName[nom]
        if (!info) continue
        const n = bot.findBlocks({ matching: info.id, maxDistance: 8, count: 50 }).length
        if (n > 0) blocks_nearby[nom] = n
    }

    return {
        position: [pos.x, pos.y, pos.z].map((v) => Math.round(v * 10) / 10),
        health: bot.health,
        food: bot.food,
        time: bot.time.timeOfDay,
        inventory,
        hostiles_nearby: hostiles.length,
        blocks_nearby,
    }
}

module.exports = { observe, isHostile }