// An identical arena for every test, built with op commands sent by the bot.
// - Walls, ceiling and underside made of barrier: unbreakable and transparent (the pathfinder
//   digs by default, it must not be able to get out).
// - High up (y=200), far from natural terrain: findBlock (32 blocks) sees nothing else.
// - The bot stands on the stone floor, at y=202, in the center (1000, 1000).

const { sleep, waitUntil } = require('../../src/skills/utils')

const MIN = { x: 977, y: 200, z: 977 }
const MAX = { x: 1023, y: 213, z: 1023 }
const FLOOR_Y = 201
const CENTER = { x: 1000, y: FLOOR_Y + 1, z: 1000 }

// Send a command and return the server's answer (or null after maxMs)
function runCommand(bot, text, maxMs = 1000) {
    return new Promise((resolve) => {
        const finish = (msg) => {
            clearTimeout(timer)
            bot.removeListener('messagestr', onMessage)
            resolve(msg)
        }
        const onMessage = (msg, position) => {
            if (position !== 'chat') finish(msg) // command answers are "system" messages
        }
        const timer = setTimeout(() => finish(null), maxMs)
        bot.on('messagestr', onMessage)
        bot.chat(text)
    })
}

// /fill fails while the chunks are not generated yet: retry
async function fillWithRetry(bot, text) {
    for (let attempt = 1; attempt <= 10; attempt++) {
        const answer = await runCommand(bot, text, 3000)
        if (answer && !/not loaded|unloaded/i.test(answer)) return answer
        await sleep(1000)
    }
    throw new Error(`command failed: ${text}`)
}

const area = `${MIN.x} ${MIN.y} ${MIN.z} ${MAX.x} ${MAX.y} ${MAX.z}`
const interior = `${MIN.x + 1} ${FLOOR_Y + 1} ${MIN.z + 1} ${MAX.x - 1} ${MAX.y - 1} ${MAX.z - 1}`
const floor = `${MIN.x + 1} ${FLOOR_Y} ${MIN.z + 1} ${MAX.x - 1} ${FLOOR_Y} ${MAX.z - 1}`

// Place blocks with a command (/fill, /setblock), then wait until the BOT sees them.
// The server answers "Successfully filled" before sending the blocks to the bot: without this
// wait, the skill starts in a world where the blocks are not there yet.
async function placeAndWait(bot, command, [x, y, z], name) {
    await runCommand(bot, command)
    const seen = await waitUntil(() => {
        const b = bot.blockAt(bot.entity.position.clone().set(x, y, z))
        return b && b.name === name
    }, 3000)
    if (!seen) throw new Error(`the bot does not see ${name} at ${x},${y},${z}`) // setup failed
}

// Give items to the bot (/give), then wait until they are really in its inventory
async function giveAndWait(bot, name, n) {
    const count = () => bot.inventory.items().filter((i) => i.name === name).reduce((t, i) => t + i.count, 0)
    const before = count()
    await runCommand(bot, `/give ${bot.username} ${name} ${n}`)
    if (!(await waitUntil(() => count() >= before + n, 3000))) {
        throw new Error(`the bot did not receive ${n} ${name}`) // setup failed
    }
}

// Run once at the start of a suite
async function prepareArena(bot) {
    const u = bot.username
    console.log('[arena] preparing...')
    await runCommand(bot, `/gamemode survival ${u}`)
    await runCommand(bot, `/forceload add ${MIN.x} ${MIN.z} ${MAX.x} ${MAX.z}`, 5000)
    await fillWithRetry(bot, `/fill ${area} barrier hollow`)
    await runCommand(bot, '/weather clear')
    await resetArena(bot)
    console.log('[arena] ready')
}

// Run before every trial: empty arena, empty inventory, full health and hunger, at the center
async function resetArena(bot) {
    const u = bot.username
    bot.pathfinder.setGoal(null)
    await runCommand(bot, `/kill @e[type=!player,x=${MIN.x},y=${MIN.y},z=${MIN.z},dx=46,dy=13,dz=46]`)
    // Killed entities stay a moment in bot.entities (death animation): wait for them to go
    await waitUntil(() => !Object.values(bot.entities).some((e) => e !== bot.entity && e.type !== 'player' &&
        e.position && e.position.y >= MIN.y && Math.abs(e.position.x - CENTER.x) < 25 && Math.abs(e.position.z - CENTER.z) < 25), 3000)
    await fillWithRetry(bot, `/fill ${interior} air`)
    await fillWithRetry(bot, `/fill ${floor} stone`) // some tests dig into the floor or put lava in it
    await runCommand(bot, `/clear ${u}`)
    await runCommand(bot, `/effect clear ${u}`)
    await runCommand(bot, `/effect give ${u} saturation 1 255 true`) // full hunger
    await runCommand(bot, `/effect give ${u} instant_health 1 5 true`) // full health
    await runCommand(bot, '/time set day')
    await runCommand(bot, `/tp ${u} ${CENTER.x + 0.5} ${CENTER.y} ${CENTER.z + 0.5}`)
    await bot.waitForChunksToLoad()
    // Wait until the bot really stands at the center
    await waitUntil(() => bot.entity.position.distanceTo(bot.entity.position.clone().set(CENTER.x + 0.5, CENTER.y, CENTER.z + 0.5)) < 0.5 && bot.entity.onGround, 5000)
    await waitUntil(() => bot.food === 20, 3000)
    await sleep(300)
}

module.exports = { runCommand, placeAndWait, giveAndWait, prepareArena, resetArena, CENTER, FLOOR_Y, MIN, MAX }
