const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { reglages } = require('./src/movements')
const { corrigerStateId } = require('./src/correctifs')
const skills = require('./src/skills')
const runSkill = require('./src/runSkill')
const execute = require('./src/execute')

const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565', 10),
    username: process.env.MC_USERNAME || 'Agent',
    version: process.env.MC_VERSION,
})
bot.loadPlugin(pathfinder)
corrigerStateId(bot) // voir src/correctifs.js

bot.on('error', (err) => console.error('[erreur]', err.message))
bot.on('kicked', (reason) => console.error('[expulsé]', reason))
bot.on('end', (reason) => console.log('[déconnecté]', reason))

bot.once('spawn', async () => {
    bot.pathfinder.setMovements(reglages(bot)) // déplacements débrouillards, voir src/movements.js
    const test = process.argv[2] // le nom du test passé dans la commande

    if (test === 'test1') {
        // Test de l'enveloppe, avec de fausses compétences
        const rapide = async () => ({ success: true, reason: 'ok', details: {} })
        const infini = () => new Promise(() => { }) // ne se termine jamais
        console.log('rapide :', await runSkill(bot, rapide, {}))
        console.log('infini :', await runSkill(bot, infini, {}, 3000)) // timeout à 3 s
    }

    if (test === 'test2') {
        // Les cas d'échec de mine
        console.log('diamant :', await runSkill(bot, skills.mine, { block: 'diamond_ore', count: 1 }))
        console.log('nom faux :', await runSkill(bot, skills.mine, { block: 'truc_inexistant', count: 1 }))
    }

    if (test === 'test3') {
        const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
        const idLog = bot.registry.blocksByName.oak_log.id

        let trouve = false
        for (let essai = 1; essai <= 10 && !trouve; essai++) {
            bot.chat('/spreadplayers 0 0 50 500 false Agent') // se téléporte au hasard
            await attendre(4000) // le temps que le terrain se charge
            trouve = !!bot.findBlock({ matching: idLog, maxDistance: 16 })
            console.log(`essai ${essai} : arbre proche ? ${trouve}`)
        }
        if (!trouve) {
            console.log('Aucun arbre trouvé, relance le test.')
        } else {
            const r = await runSkill(bot, skills.mine, { block: 'oak_log', count: 3 })
            console.log('mine :', r)
            console.log('inventaire :', bot.inventory.items().map((i) => `${i.name} x${i.count}`))
        }
    }

    if (test === 'test4') {
        // même recherche d'arbre que test3, puis 5 minages d'affilée
        const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
        const idLog = bot.registry.blocksByName.oak_log.id
        let trouve = false
        for (let essai = 1; essai <= 10 && !trouve; essai++) {
            bot.chat('/spreadplayers 0 0 50 500 false Agent')
            await attendre(4000)
            trouve = !!bot.findBlock({ matching: idLog, maxDistance: 16 })
        }
        for (let i = 1; i <= 5; i++) {
            const r = await execute(bot, 'mine', { block: 'oak_log', count: 2 }, 'test')
            console.log(`mine ${i} :`, r.success, r.reason, r.duration)
        }
    }

    if (test === 'serve') {
        // Mode API : le bot reste connecté et attend les ordres du cerveau (voir src/api.js)
        // node --env-file=../.env bot.js serve
        const port = parseInt(process.env.API_PORT || '3000', 10)
        await require('./src/api').demarrerApi(bot, { port })
        console.log(`[api] prête sur http://127.0.0.1:${port} (GET /state, GET /skills, POST /execute)`)
        // Si le bot est déconnecté, l'API n'a plus de sens : on arrête tout pour que le cerveau le voie
        bot.on('end', () => process.exit(1))
        return // pas de bot.quit() : le bot reste en ligne
    }

    if (test === 'suite') {
        // Suite de tests en jeu : node --env-file=../.env bot.js suite move_to 10
        try {
            await require('./tests/game/run')(bot, process.argv[3], process.argv[4])
        } catch (e) {
            console.error('[suite] erreur :', e)
        }
    }

    bot.quit() // termine le programme à la fin du test
})