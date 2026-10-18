const { cmd, poser, CENTRE: C } = require('./arena')
const { attendreQue } = require('../../src/skills/outils')
const { isHostile } = require('../../src/state')

// Des bûches à des distances connues : la plus proche doit sortir en premier
const BUCHES = [[12, 0], [3, 4], [-15, -10]] // [dx, dz] -> distances ~12, 5, 18
const PLUS_PROCHE = [C.x + 3, C.y, C.z + 4]

const nominaux = [
    {
        nom: 'bûches triées par distance',
        setup: async (bot) => {
            for (const [dx, dz] of BUCHES) await poser(bot, `/setblock ${C.x + dx} ${C.y} ${C.z + dz} oak_log`, [C.x + dx, C.y, C.z + dz], 'oak_log')
        },
        args: { target: 'oak_log' },
        verify: (r) => {
            const m = r.details.matches
            if (m.length !== BUCHES.length) return `${m.length} bûches trouvées au lieu de ${BUCHES.length}`
            const premier = [m[0].x, m[0].y, m[0].z].join(',')
            return premier === PLUS_PROCHE.join(',') || `la plus proche annoncée est ${premier}`
        },
    },
    {
        nom: 'un husk trouvé avec "hostile"',
        setup: async (bot) => {
            await cmd(bot, `/summon husk ${C.x + 6.5} ${C.y} ${C.z + 0.5} {NoAI:1b}`)
            if (!(await attendreQue(() => Object.values(bot.entities).some(isHostile), 3000))) throw new Error('husk invisible')
        },
        args: { target: 'hostile' },
        verify: (r) => (r.details.matches[0].name === 'husk' && Math.abs(r.details.matches[0].distance - 6) < 1.5) ||
            `trouvé : ${JSON.stringify(r.details.matches[0])}`,
    },
]

const limites = [
    { nom: 'rien de tel autour', args: { target: 'diamond_ore' }, expect: 'not_found' },
    { nom: 'cible inconnue', args: { target: 'truc' }, expect: 'unknown_target' },
]

module.exports = { skill: 'find', nominaux, limites }
