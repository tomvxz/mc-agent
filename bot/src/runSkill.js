async function runSkill(bot, skill, args, timeoutMs = 60000) {
    const start = Date.now()
    let timer

    // A promise that fails after timeoutMs
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })

    let result
    try {
        // Whichever finishes first wins: the skill or the deadline
        result = await Promise.race([skill(bot, args), deadline])
    } catch (e) {
        result = {
            success: false,
            reason: e.message === 'timeout' ? 'timeout' : 'exception',
            details: { error: e.message },
        }
        // setGoal(null) stops immediately; stop() waited for the next block
        // and made the following skill fail (instant no_path)
        bot.pathfinder.setGoal(null)
        bot.stopDigging()
    } finally {
        clearTimeout(timer)
    }

    // A skill that does not return { success, reason } is a bug
    if (!result || typeof result.success !== 'boolean') {
        result = { success: false, reason: 'bad_result', details: { value: result } }
    }

    return { ...result, duration: (Date.now() - start) / 1000 }
}

module.exports = runSkill
