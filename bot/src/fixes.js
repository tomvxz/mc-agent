// Fixes for Mineflayer bugs, applied once in bot.js.
// We never edit node_modules (versions are pinned): we fix things from our own code.

// Bug (Mineflayer 4.39, server 1.21.11): each window (inventory = 0, crafting table = 1, 2...)
// has its own "stateId" counter, but Mineflayer keeps a single one for all of them. When the
// server updates the inventory while a table is open, clicks are sent with the inventory's
// counter; the server then resends the whole window, Mineflayer resyncs to a stale state and
// makes wrong clicks: about 1 table craft in 2 failed.
// Fix: remember the latest stateId of EACH window and put it back into the clicks.
function fixStateId(bot) {
    const stateIds = {} // { window id: latest stateId received }
    const remember = (packet) => { stateIds[packet.windowId] = packet.stateId }
    bot._client.on('window_items', remember)
    bot._client.on('set_slot', remember)

    const write = bot._client.write.bind(bot._client)
    bot._client.write = (name, packet) => {
        // stateId -1 means "send me everything", Mineflayer uses it on purpose: leave it alone
        if (name === 'window_click' && packet.stateId !== -1 && stateIds[packet.windowId] !== undefined) {
            packet = { ...packet, stateId: stateIds[packet.windowId] }
        }
        return write(name, packet)
    }
}

module.exports = { fixStateId }
