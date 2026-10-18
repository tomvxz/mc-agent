// Petites fonctions partagées par plusieurs compétences (ce n'est pas une compétence)
const { goals } = require('mineflayer-pathfinder')

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Attend que condition() devienne vraie, au plus maxMs. Renvoie true si c'est arrivé.
async function attendreQue(condition, maxMs) {
    const fin = Date.now() + maxMs
    while (Date.now() < fin) {
        if (condition()) return true
        await attendre(50)
    }
    return condition()
}

// Traduit une erreur du pathfinder en raison d'échec lisible
function raisonDeplacement(e) {
    if (e.name === 'NoPath') return 'no_path'
    if (e.name === 'Timeout') return 'path_timeout' // il a réfléchi trop longtemps
    if (e.name === 'GoalChanged' || e.name === 'PathStopped') return 'interrupted'
    return 'exception'
}

// Fabrique un Vec3 (vecteur 3D de Mineflayer) en copiant la position du bot puis en changeant x, y, z
function vecteur(bot, x, y, z) {
    return bot.entity.position.clone().set(x, y, z)
}

// Arrondi à 0,1 près, pour des details lisibles
const arrondi = (v) => Math.round(v * 10) / 10

// Inventaire sous forme { nom: quantité }
function inventaire(bot) {
    const inv = {}
    for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count
    return inv
}

// Ce qui a été gagné depuis `avant` (seulement les quantités en hausse) : { oak_log: 2 }
function gagne(bot, avant) {
    const gains = {}
    for (const [nom, n] of Object.entries(inventaire(bot))) {
        if (n > (avant[nom] || 0)) gains[nom] = n - (avant[nom] || 0)
    }
    return gains
}

// Compte les blocs posés et cassés par le bot pendant un déplacement
// (le pathfinder monte en tour, fait des ponts et creuse des passages tout seul).
// Posés = blocs d'échafaudage consommés dans l'inventaire (pendant un trajet, seul le
// pathfinder en pose ; l'événement blockPlaced de Mineflayer ne part pas toujours).
function compterModifications(bot) {
    const { ECHAFAUDAGE } = require('../movements')
    const echafaudage = () => ECHAFAUDAGE.reduce((n, nom) => n + (inventaire(bot)[nom] || 0), 0)
    const avant = echafaudage()
    let casses = 0
    const casse = () => casses++
    bot.on('diggingCompleted', casse)
    return () => {
        bot.removeListener('diggingCompleted', casse)
        return { blocks_placed: Math.max(0, avant - echafaudage()), blocks_broken: casses }
    }
}

// Après un bloc cassé, l'objet tombe par terre : on va le ramasser
async function ramasser(bot, p) {
    const objetTombe = () => Object.values(bot.entities).find((e) => e.name === 'item' && e.position.distanceTo(p) < 3)
    await attendreQue(objetTombe, 1000) // l'objet apparaît un peu après la casse
    const objet = objetTombe()
    if (!objet) return
    try {
        // Attendre qu'il soit retombé au sol, puis s'en approcher à 1 bloc (on ramasse à cette
        // distance ; viser 0 pousse le pathfinder à casser les blocs au-dessus pour s'y tenir)
        await attendre(500)
        const o = objet.position
        await bot.pathfinder.goto(new goals.GoalNear(o.x, o.y, o.z, 1))
    } catch (e) {
        return // pas grave ici : le bilan "collected" dira si l'objet manque
    }
    const ramasse = () => !bot.entities[objet.id] // ramassé = l'entité disparaît
    if (await attendreQue(ramasse, 500)) return

    // Encore là : on le regarde et on avance tout droit vers lui (au plus 1 s)
    await bot.lookAt(objet.position, true)
    bot.setControlState('forward', true)
    await attendreQue(ramasse, 1000)
    bot.setControlState('forward', false)
}

module.exports = {
    attendre, attendreQue, raisonDeplacement, vecteur, arrondi,
    inventaire, gagne, compterModifications, ramasser,
}
