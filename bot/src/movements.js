const { Movements } = require('mineflayer-pathfinder')
const { isHostile } = require('./state')

// Réglages de déplacement du pathfinder.
// Principe : le LLM décide OÙ aller, le pathfinder décide COMMENT passer les obstacles
// (sauter, creuser, monter en tour, ouvrir une porte). On ajoute des instincts pour que
// ces capacités ne tuent pas le bot et ne cassent pas ce qui compte.

// Correction d'un bug : le pathfinder accepte une diagonale dès qu'UN des deux côtés est libre ;
// le bot frôle alors l'angle du bloc et reste coincé contre lui (vu dans les tests de move_to).
// On exige donc que les DEUX côtés soient libres.
class MovementsSansCoin extends Movements {
    getMoveDiagonal(node, dir, neighbors) {
        // y = 1 si la diagonale monte d'une marche
        const y = this.getBlock(node, dir.x, 0, dir.z).physical ? 1 : 0
        for (const [dx, dz] of [[dir.x, 0], [0, dir.z]]) {
            // Les pieds et la tête doivent passer de chaque côté
            if (!this.getBlock(node, dx, y, dz).safe || !this.getBlock(node, dx, y + 1, dz).safe) return
        }
        super.getMoveDiagonal(node, dir, neighbors)
    }
}

// Blocs à ne jamais traverser (la lave, le feu et les toiles sont déjà évités par défaut)
const A_EVITER = ['soul_fire', 'cactus', 'sweet_berry_bush', 'powder_snow', 'wither_rose']
// Blocs sur lesquels ne jamais marcher (ils brûlent)
const SOL_DANGEREUX = ['magma_block', 'campfire', 'soul_campfire']
// Blocs utiles à ne jamais casser en passant
// (+ tous les lits, portes et portillons, ajoutés plus bas)
const A_PROTEGER = ['chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker',
    'crafting_table', 'anvil', 'enchanting_table']
// Blocs "jetables" que le pathfinder peut poser pour monter ou faire un pont
const ECHAFAUDAGE = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack']

const DISTANCE_MONSTRE = 4 // les cases plus proches d'un monstre coûtent plus cher
const COUT_MONSTRE = 20

function creer(bot) {
    const r = bot.registry
    const m = new MovementsSansCoin(bot)

    // Capacités : on garde celles du pathfinder (parkour, sprint, creuser, tours) et on les règle
    m.canDig = true
    m.digCost = 2 // creuser coûte : il préfère contourner un petit obstacle
    m.allow1by1towers = true
    m.placeCost = 2
    m.scafoldingBlocks = ECHAFAUDAGE.map((n) => r.itemsByName[n].id)
    // Pas d'ouverture de portes : dans cette version du pathfinder, l'option ne gère que les portillons,
    // et même là, en test, il cassait le portillon ou restait bloqué devant en se disant arrivé.
    // Une porte fermée donne donc no_path ; l'ouvrir sera le rôle de use_item (lot 2).
    m.canOpenDoors = false

    // Instincts
    m.liquidCost = 3 // l'eau coûte plus cher : il la contourne s'il peut
    m.maxDropDown = 3 // pas de chute de plus de 3 blocs (pas de dégâts)
    for (const n of A_EVITER) m.blocksToAvoid.add(r.blocksByName[n].id)
    for (const n of A_PROTEGER) m.blocksCantBreak.add(r.blocksByName[n].id)
    for (const n of Object.keys(r.blocksByName)) {
        if (n.endsWith('_bed') || n.endsWith('_door') || n.endsWith('_fence_gate')) m.blocksCantBreak.add(r.blocksByName[n].id)
    }
    const solDangereux = new Set(SOL_DANGEREUX.map((n) => r.blocksByName[n].id))

    // Position des monstres, recalculée au plus une fois par seconde (le pathfinder
    // appelle cette fonction pour chaque case qu'il envisage : il faut qu'elle soit rapide)
    let monstres = []
    let dateMonstres = 0
    const positionsMonstres = () => {
        if (Date.now() - dateMonstres > 1000) {
            monstres = Object.values(bot.entities).filter((e) => isHostile(e) && e.position).map((e) => e.position)
            dateMonstres = Date.now()
        }
        return monstres
    }

    // Coût supplémentaire pour poser les pieds sur une case
    m.exclusionAreasStep.push((block) => {
        const p = block.position
        const dessous = bot.blockAt(p.offset(0, -1, 0))
        if (dessous && solDangereux.has(dessous.type)) return 100 // 100 = interdit
        for (const pos of positionsMonstres()) {
            if (pos.distanceTo(p) < DISTANCE_MONSTRE) return COUT_MONSTRE
        }
        return 0
    })
    return m
}

// Un seul réglage par bot, créé une fois (sa construction parcourt tous les blocs du jeu)
const cache = new WeakMap()
function reglages(bot) {
    if (!cache.has(bot)) cache.set(bot, creer(bot))
    return cache.get(bot)
}

module.exports = { reglages, MovementsSansCoin, ECHAFAUDAGE }
