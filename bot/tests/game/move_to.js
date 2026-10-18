const { cmd, poser, donner, MIN, MAX, CENTRE: C } = require('./arena')
const { attendreQue } = require('../../src/skills/outils')
const { isHostile } = require('../../src/state')

// Un mur sur toute la largeur de l'arène, en z = C.z + 5, de y à y + h - 1
const mur = (bot, matiere, h = 11) =>
    poser(bot, `/fill ${MIN.x + 1} ${C.y} ${C.z + 5} ${MAX.x - 1} ${C.y + h - 1} ${C.z + 5} ${matiere}`, [C.x, C.y + h - 1, C.z + 5], matiere)

const bloc = (bot, x, y, z) => bot.blockAt(bot.entity.position.clone().set(x, y, z))

// La vérification ne croit pas la compétence sur parole : elle mesure la distance réelle
const arriveA = (cible, range = 1) => (r, avant, apres, bot) => {
    const d = bot.entity.position.distanceTo(bot.entity.position.clone().set(...cible))
    return d <= range + 1 || `distance réelle ${d.toFixed(1)}`
}

// Plusieurs vérifications à la suite : la première qui échoue donne son message
const tout = (...verifs) => async (...a) => {
    for (const v of verifs) {
        const res = await v(...a)
        if (res !== true) return res
    }
    return true
}
const sante20 = (r, avant, apres, bot) => bot.health >= 20 || `santé ${bot.health}`

const CIBLE = [C.x, C.y, C.z + 10] // de l'autre côté de l'obstacle (z = C.z + 5)
const versCible = { x: CIBLE[0], y: CIBLE[1], z: CIBLE[2] }

// Cibles sur sol plat
const nominaux = [[10, 0], [-10, -10], [15, 15], [-20, 20], [0, -20]].map(([dx, dz]) => {
    const cible = [C.x + dx, C.y, C.z + dz]
    return { nom: `plat ${dx},${dz}`, args: { x: cible[0], y: cible[1], z: cible[2] }, verify: arriveA(cible) }
})

// Le suivi de distance au husk (cas "contourner un monstre")
let suivi = null

nominaux.push(
    {
        nom: 'contourner l\'angle d\'un mur',
        setup: (bot) => poser(bot, `/fill ${C.x - 5} ${C.y} ${C.z + 5} ${C.x + 5} ${C.y + 3} ${C.z + 5} barrier`, [C.x + 5, C.y + 3, C.z + 5], 'barrier'),
        args: versCible,
        verify: arriveA(CIBLE),
    },
    {
        nom: 'réflexe : sauter une tranchée de lave (2 de large, toute la largeur)',
        setup: (bot) => poser(bot, `/fill ${MIN.x + 1} ${C.y - 1} ${C.z + 4} ${MAX.x - 1} ${C.y - 1} ${C.z + 5} lava`, [C.x, C.y - 1, C.z + 5], 'lava'),
        args: versCible,
        verify: tout(arriveA(CIBLE), sante20),
    },
    {
        nom: 'réflexe : contourner une bande de lave (3 de large)',
        setup: (bot) => poser(bot, `/fill ${C.x - 10} ${C.y - 1} ${C.z + 4} ${C.x + 10} ${C.y - 1} ${C.z + 6} lava`, [C.x, C.y - 1, C.z + 6], 'lava'),
        args: versCible,
        verify: tout(arriveA(CIBLE), sante20),
    },
    {
        nom: 'réflexe : monter sur un plateau de 3 blocs (terre donnée)',
        setup: async (bot) => {
            await donner(bot, 'dirt', 8)
            await poser(bot, `/fill ${C.x + 5} ${C.y} ${C.z - 5} ${C.x + 12} ${C.y + 2} ${C.z + 5} stone`, [C.x + 12, C.y + 2, C.z + 5], 'stone')
        },
        args: { x: C.x + 8, y: C.y + 3, z: C.z },
        verify: tout(arriveA([C.x + 8, C.y + 3, C.z]), (r) =>
            r.details.blocks_placed + r.details.blocks_broken > 0 || 'aucun bloc posé ni cassé : comment est-il monté ?'),
    },
    {
        nom: 'réflexe : creuser un mur de pierre qui ferme tout',
        setup: (bot) => mur(bot, 'stone'),
        args: versCible,
        verify: tout(arriveA(CIBLE), (r) => r.details.blocks_broken > 0 || 'aucun bloc cassé'),
    },
    {
        nom: 'réflexe : passer par-dessus un coffre sans le casser',
        setup: async (bot) => {
            await mur(bot, 'barrier', 3)
            await cmd(bot, `/setblock ${C.x} ${C.y + 1} ${C.z + 5} air`)
            await cmd(bot, `/setblock ${C.x} ${C.y + 2} ${C.z + 5} air`)
            await poser(bot, `/setblock ${C.x} ${C.y} ${C.z + 5} chest`, [C.x, C.y, C.z + 5], 'chest')
        },
        args: versCible,
        verify: tout(arriveA(CIBLE), (r, a, b, bot) => bloc(bot, C.x, C.y, C.z + 5).name === 'chest' || 'coffre cassé'),
    },
    {
        nom: 'instinct : garder ses distances avec un husk sur la ligne droite',
        setup: async (bot) => {
            await cmd(bot, `/summon husk ${C.x + 0.5} ${C.y} ${C.z + 5.5} {NoAI:1b}`)
            if (!(await attendreQue(() => Object.values(bot.entities).some(isHostile), 3000))) {
                throw new Error('monstre invisible pour le bot')
            }
            // Relever la distance minimale au husk pendant tout le trajet
            if (suivi) clearInterval(suivi.minuteur)
            suivi = { min: Infinity }
            suivi.minuteur = setInterval(() => {
                const h = Object.values(bot.entities).find(isHostile)
                if (h) suivi.min = Math.min(suivi.min, h.position.distanceTo(bot.entity.position))
            }, 100)
            setTimeout(() => clearInterval(suivi.minuteur), 60000)
        },
        args: versCible,
        verify: tout(arriveA(CIBLE), () => {
            clearInterval(suivi.minuteur)
            return suivi.min >= 3 || `passé à ${suivi.min.toFixed(1)} blocs du husk`
        }),
    },
)

const limites = [
    {
        nom: 'cible enfermée dans de la barrière (incassable)',
        setup: (bot) => poser(bot, `/fill ${C.x + 9} ${C.y - 1} ${C.z - 11} ${C.x + 11} ${C.y + 2} ${C.z - 9} barrier hollow`, [C.x + 11, C.y + 2, C.z - 9], 'barrier'),
        args: { x: C.x + 10, y: C.y, z: C.z - 10 },
        expect: 'no_path',
    },
    {
        nom: 'portillon fermé dans un mur incassable : pas d\'ouverture automatique (lot 2 : use_item)',
        setup: async (bot) => {
            await mur(bot, 'barrier')
            await poser(bot, `/setblock ${C.x} ${C.y} ${C.z + 5} oak_fence_gate[facing=south]`, [C.x, C.y, C.z + 5], 'oak_fence_gate')
            await cmd(bot, `/setblock ${C.x} ${C.y + 1} ${C.z + 5} air`) // de la place pour la tête
        },
        args: versCible,
        expect: 'no_path',
    },
    { nom: 'arguments invalides', args: { x: 'loin' }, expect: 'invalid_args' },
]

module.exports = { skill: 'move_to', nominaux, limites }
