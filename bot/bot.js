const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { getMovements } = require('./src/movements')
const { fixStateId } = require('./src/fixes')
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
fixStateId(bot) // see src/fixes.js

bot.on('error', (err) => console.error('[error]', err.message))
bot.on('kicked', (reason) => console.error('[kicked]', reason))
bot.on('end', (reason) => console.log('[disconnected]', reason))

bot.once('spawn', async () => {
    bot.pathfinder.setMovements(getMovements(bot)) // resourceful movement, see src/movements.js
    const test = process.argv[2] // the test name given on the command line

    if (test === 'test1') {
        // Test the wrapper with fake skills
        const fast = async () => ({ success: true, reason: 'ok', details: {} })
        const endless = () => new Promise(() => { }) // never finishes
        console.log('fast:', await runSkill(bot, fast, {}))
        console.log('endless:', await runSkill(bot, endless, {}, 3000)) // 3 s timeout
    }

    if (test === 'test2') {
        // Failure cases of mine
        console.log('diamond:', await runSkill(bot, skills.mine, { block: 'diamond_ore', count: 1 }))
        console.log('wrong name:', await runSkill(bot, skills.mine, { block: 'no_such_block', count: 1 }))
    }

    if (test === 'test3') {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        const logId = bot.registry.blocksByName.oak_log.id

        let found = false
        for (let attempt = 1; attempt <= 10 && !found; attempt++) {
            bot.chat('/spreadplayers 0 0 50 500 false Agent') // random teleport
            await sleep(4000) // give the terrain time to load
            found = !!bot.findBlock({ matching: logId, maxDistance: 16 })
            console.log(`attempt ${attempt}: tree nearby? ${found}`)
        }
        if (!found) {
            console.log('No tree found, run the test again.')
        } else {
            const r = await runSkill(bot, skills.mine, { block: 'oak_log', count: 3 })
            console.log('mine:', r)
            console.log('inventory:', bot.inventory.items().map((i) => `${i.name} x${i.count}`))
        }
    }

    if (test === 'test4') {
        // same tree search as test3, then 5 mine calls in a row
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        const logId = bot.registry.blocksByName.oak_log.id
        let found = false
        for (let attempt = 1; attempt <= 10 && !found; attempt++) {
            bot.chat('/spreadplayers 0 0 50 500 false Agent')
            await sleep(4000)
            found = !!bot.findBlock({ matching: logId, maxDistance: 16 })
        }
        for (let i = 1; i <= 5; i++) {
            const r = await execute(bot, 'mine', { block: 'oak_log', count: 2 }, 'test')
            console.log(`mine ${i}:`, r.success, r.reason, r.duration)
        }
    }

    if (test === 'serve') {
        // API mode: the bot stays connected and waits for orders from the brain (see src/api.js)
        // node --env-file=../.env bot.js serve
        const port = parseInt(process.env.API_PORT || '3000', 10)
        await require('./src/api').startApi(bot, { port })
        console.log(`[api] ready on http://127.0.0.1:${port} (GET /state, GET /skills, POST /execute)`)
        // If the bot is disconnected the API is useless: exit so the brain notices
        bot.on('end', () => process.exit(1))
        return // no bot.quit(): the bot stays online
    }

    if (test === 'suite') {
        // In-game test suite: node --env-file=../.env bot.js suite move_to 10
        try {
            await require('./tests/game/run')(bot, process.argv[3], process.argv[4])
        } catch (e) {
            console.error('[suite] error:', e)
        }
    }

    bot.quit() // end the program once the test is done
})
