// Server commands sent by our own code (/give, /tp, /fill...).
// Always send them through runCommand(): one place to change if we need to watch them again.

// Send a command (or a chat message) and return the server's answer, or null after maxMs
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

export { runCommand }