const runSkill = require('./runSkill')
const skills = require('./skills')
const { observe } = require('./state')
const { logTransition } = require('./logger')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// If the bot is dead or disconnected, observe() throws: record null instead of losing the transition
function safeObserve(bot) {
    try {
        return observe(bot)
    } catch (e) {
        return null
    }
}

// Version of the journal line format: bump it when the shape changes (see CLAUDE.md)
const SCHEMA_VERSION = 1

// meta (optional): { episode_id, step } when the call comes from the brain, to link plans and results
async function execute(bot, name, args = {}, source = 'manual', meta = {}) {
    const before = safeObserve(bot)

    let result
    let after
    if (Object.hasOwn(skills, name)) {
        result = await runSkill(bot, skills[name], args)
        await sleep(300) // let the inventory update
        after = safeObserve(bot)
    } else {
        // Unknown name: nothing runs, but the failure is still logged
        result = { success: false, reason: 'unknown_skill', details: {}, duration: 0 }
        after = before
    }

    // Writing the journal must never crash the bot
    try {
        logTransition({
            schema_version: SCHEMA_VERSION,
            ts: new Date().toISOString(),
            source,
            // Optional fields: absent from lines that do not come from an episode
            ...(meta.episode_id !== undefined && { episode_id: meta.episode_id }),
            ...(meta.step !== undefined && { step: meta.step }),
            state: before,
            skill: { name, args },
            next_state: after,
            success: result.success,
            reason: result.reason,
            duration: result.duration,
        })
    } catch (e) {
        console.error('[journal] cannot write:', e.message)
    }
    return result
}

module.exports = execute
