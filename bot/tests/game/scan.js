const { cmd, poser, CENTRE: C } = require('./arena')
const { attendreQue } = require('../../src/skills/outils')
const { isHostile } = require('../../src/state')

// Ce qu'on pose, et ce que scan doit compter exactement
const POSES = [
    ['oak_log', [3, 0], [3, 1], [3, 2]],
    ['iron_ore', [-5, 4], [-6, 4]],
    ['crafting_table', [0, -7]],
]

const nominaux = [{
    nom: 'compte ce qui a été posé',
    setup: async (bot) => {
        for (const [nom, ...positions] of POSES) {
            for (const [dx, dz] of positions) await poser(bot, `/setblock ${C.x + dx} ${C.y} ${C.z + dz} ${nom}`, [C.x + dx, C.y, C.z + dz], nom)
        }
        await cmd(bot, `/summon husk ${C.x + 8.5} ${C.y} ${C.z + 0.5} {NoAI:1b}`)
        if (!(await attendreQue(() => Object.values(bot.entities).some(isHostile), 3000))) throw new Error('husk invisible')
    },
    args: { radius: 16 },
    verify: (r) => {
        for (const [nom, ...positions] of POSES) {
            const vu = r.details.blocks[nom] ? r.details.blocks[nom].count : 0
            if (vu !== positions.length) return `${nom} : ${vu} au lieu de ${positions.length}`
        }
        const autres = Object.keys(r.details.blocks).filter((n) => !POSES.some(([nom]) => nom === n))
        if (autres.length) return `blocs en trop : ${autres.join(', ')}`
        return (r.details.entities.husk && r.details.entities.husk.count === 1) || 'husk non compté'
    },
}]

const limites = [{ nom: 'rayon invalide', args: { radius: 100 }, expect: 'invalid_args' }]

module.exports = { skill: 'scan', nominaux, limites }
