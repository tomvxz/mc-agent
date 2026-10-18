// Une arène identique à chaque test, construite avec des commandes op envoyées par le bot.
// - Murs, plafond et dessous en barrière : incassables et transparents (le pathfinder
//   creuse par défaut, il ne doit pas pouvoir sortir).
// - En hauteur (y=200), loin du terrain naturel : findBlock (32 blocs) ne voit rien d'autre.
// - Le bot se tient sur le sol en pierre, en y=202, au centre (1000, 1000).

const { attendre, attendreQue } = require('../../src/skills/outils')

const MIN = { x: 977, y: 200, z: 977 }
const MAX = { x: 1023, y: 213, z: 1023 }
const SOL = 201
const CENTRE = { x: 1000, y: SOL + 1, z: 1000 }

// Envoie une commande et renvoie la réponse du serveur (ou null après maxMs)
function cmd(bot, texte, maxMs = 1000) {
    return new Promise((resolve) => {
        const fin = (msg) => {
            clearTimeout(minuteur)
            bot.removeListener('messagestr', surMessage)
            resolve(msg)
        }
        const surMessage = (msg, position) => {
            if (position !== 'chat') fin(msg) // les réponses aux commandes sont des messages "system"
        }
        const minuteur = setTimeout(() => fin(null), maxMs)
        bot.on('messagestr', surMessage)
        bot.chat(texte)
    })
}

// /fill échoue si les chunks ne sont pas encore générés : on réessaie
async function remplir(bot, texte) {
    for (let essai = 1; essai <= 10; essai++) {
        const reponse = await cmd(bot, texte, 3000)
        if (reponse && !/not loaded|unloaded/i.test(reponse)) return reponse
        await attendre(1000)
    }
    throw new Error(`commande impossible : ${texte}`)
}

const zone = `${MIN.x} ${MIN.y} ${MIN.z} ${MAX.x} ${MAX.y} ${MAX.z}`
const interieur = `${MIN.x + 1} ${SOL + 1} ${MIN.z + 1} ${MAX.x - 1} ${MAX.y - 1} ${MAX.z - 1}`
const sol = `${MIN.x + 1} ${SOL} ${MIN.z + 1} ${MAX.x - 1} ${SOL} ${MAX.z - 1}`

// Pose des blocs avec une commande (/fill, /setblock), puis attend que le BOT les voie.
// Le serveur répond "Successfully filled" avant d'envoyer les blocs au bot : sans cette
// attente, la compétence démarre dans un monde où les blocs ne sont pas encore là.
async function poser(bot, commande, [x, y, z], nom) {
    await cmd(bot, commande)
    const vu = await attendreQue(() => {
        const b = bot.blockAt(bot.entity.position.clone().set(x, y, z))
        return b && b.name === nom
    }, 3000)
    if (!vu) throw new Error(`le bot ne voit pas ${nom} en ${x},${y},${z}`) // mise en place ratée
}

// Donne des objets au bot (/give), puis attend qu'ils soient vraiment dans son inventaire
async function donner(bot, nom, n) {
    const compte = () => bot.inventory.items().filter((i) => i.name === nom).reduce((t, i) => t + i.count, 0)
    const avant = compte()
    await cmd(bot, `/give ${bot.username} ${nom} ${n}`)
    if (!(await attendreQue(() => compte() >= avant + n, 3000))) {
        throw new Error(`le bot n'a pas reçu ${n} ${nom}`) // mise en place ratée
    }
}

// À faire une fois au début d'une suite
async function preparer(bot) {
    const u = bot.username
    console.log('[arène] préparation...')
    await cmd(bot, `/gamemode survival ${u}`)
    await cmd(bot, `/forceload add ${MIN.x} ${MIN.z} ${MAX.x} ${MAX.z}`, 5000)
    await remplir(bot, `/fill ${zone} barrier hollow`)
    await cmd(bot, '/weather clear')
    await reinitialiser(bot)
    console.log('[arène] prête')
}

// À faire avant chaque essai : arène vide, inventaire vide, santé et faim pleines, au centre
async function reinitialiser(bot) {
    const u = bot.username
    bot.pathfinder.setGoal(null)
    await cmd(bot, `/kill @e[type=!player,x=${MIN.x},y=${MIN.y},z=${MIN.z},dx=46,dy=13,dz=46]`)
    // Les entités tuées restent un instant dans bot.entities (animation de mort) : on attend qu'elles partent
    await attendreQue(() => !Object.values(bot.entities).some((e) => e !== bot.entity && e.type !== 'player' &&
        e.position && e.position.y >= MIN.y && Math.abs(e.position.x - CENTRE.x) < 25 && Math.abs(e.position.z - CENTRE.z) < 25), 3000)
    await remplir(bot, `/fill ${interieur} air`)
    await remplir(bot, `/fill ${sol} stone`) // certains tests creusent ou mettent de la lave dans le sol
    await cmd(bot, `/clear ${u}`)
    await cmd(bot, `/effect clear ${u}`)
    await cmd(bot, `/effect give ${u} saturation 1 255 true`) // faim pleine
    await cmd(bot, `/effect give ${u} instant_health 1 5 true`) // santé pleine
    await cmd(bot, '/time set day')
    await cmd(bot, `/tp ${u} ${CENTRE.x + 0.5} ${CENTRE.y} ${CENTRE.z + 0.5}`)
    await bot.waitForChunksToLoad()
    // Attendre que le bot soit vraiment posé au centre
    await attendreQue(() => bot.entity.position.distanceTo(bot.entity.position.clone().set(CENTRE.x + 0.5, CENTRE.y, CENTRE.z + 0.5)) < 0.5 && bot.entity.onGround, 5000)
    await attendreQue(() => bot.food === 20, 3000)
    await attendre(300)
}

module.exports = { cmd, poser, donner, preparer, reinitialiser, CENTRE, SOL, MIN, MAX }
