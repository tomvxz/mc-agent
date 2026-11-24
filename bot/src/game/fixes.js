// Fixes for Mineflayer bugs, applied once in bot.js.
// We never edit node_modules (versions are pinned): we fix things from our own code.

import AABB from "prismarine-physics/lib/aabb.js"; // the physics' collision box class (same instance as Mineflayer's)

/* Bug (Mineflayer 4.39, server 1.21.11): each window (inventory = 0, crafting table = 1, 2...)
has its own "stateId" counter, but Mineflayer keeps a single one for all of them. When the
server updates the inventory while a table is open, clicks are sent with the inventory's
counter; the server then resends the whole window, Mineflayer resyncs to a stale state and
makes wrong clicks: about 1 table craft in 2 failed.
Fix: remember the latest stateId of EACH window and put it back into the clicks. */
function fixStateId(bot) {
    const stateIds = {}; // { window id: latest stateId received }
    const remember = (packet) => {
        stateIds[packet.windowId] = packet.stateId;
    };
    bot._client.on("window_items", remember);
    bot._client.on("set_slot", remember);

    const write = bot._client.write.bind(bot._client);
    bot._client.write = (name, packet) => {
        // stateId -1 means "send me everything", Mineflayer uses it on purpose: leave it alone
        if (
            name === "window_click" &&
            packet.stateId !== -1 &&
            stateIds[packet.windowId] !== undefined
        ) {
            packet = { ...packet, stateId: stateIds[packet.windowId] };
        }
        return write(name, packet);
    };
}

/* Bug (Mineflayer 4.39, protocol 1.21.11): the "difficulty" packet already arrives decoded as text
("easy"), but Mineflayer translates it again with its own table (names[number]), which gives
undefined: bot.game.difficulty is never set. Mineflayer's listener is installed AFTER ours (its
plugins load a bit later), so the fix is applied once every listener has run (queueMicrotask). */
function fixDifficulty(bot) {
    const NAMES = ["peaceful", "easy", "normal", "hard"];
    bot._client.on("difficulty", (packet) => {
        const d = packet.difficulty;
        queueMicrotask(() => {
            bot.game.difficulty = typeof d === "string" ? d : NAMES[d];
        });
    });
}

/* Bug (prismarine-physics 1.11, used by Mineflayer, against Paper 1.21.11): when the bot walks into
a wall, the physics puts its box EXACTLY against the block face. Paper counts that exact contact
as a collision and silently sends the bot back (a "position" packet) ; the bot pushes again, and
so on every tick: it stays frozen against the wall.
Measured threshold: a gap of 1e-9 block still gets corrected, 1e-6 does not, which matches Paper's collision tolerance (1e-7). 
1 mm is ~10 000 times that margin, still invisible in the game. Ceilings are not affected (tested).
Fix: when a horizontal move (x or z) is stopped by a block, stop 1 mm before its face. Vertical
moves are not changed (standing exactly on the ground is normal and accepted).
This changes the shared physics class, so it is done once for the whole program. */
const WALL_GAP = 0.001; // 1 mm: invisible in the game, enough for the server
let wallGapApplied = false;
function fixWallContact() {
    if (wallGapApplied) return;
    wallGapApplied = true;
    // Same code as prismarine-physics, with "- WALL_GAP" / "+ WALL_GAP" added
    AABB.prototype.computeOffsetX = function (other, offsetX) {
        if (
            other.maxY > this.minY &&
            other.minY < this.maxY &&
            other.maxZ > this.minZ &&
            other.minZ < this.maxZ
        ) {
            if (offsetX > 0.0 && other.maxX <= this.minX) {
                offsetX = Math.min(this.minX - other.maxX - WALL_GAP, offsetX);
            } else if (offsetX < 0.0 && other.minX >= this.maxX) {
                offsetX = Math.max(this.maxX - other.minX + WALL_GAP, offsetX);
            }
        }
        return offsetX;
    };
    AABB.prototype.computeOffsetZ = function (other, offsetZ) {
        if (
            other.maxX > this.minX &&
            other.minX < this.maxX &&
            other.maxY > this.minY &&
            other.minY < this.maxY
        ) {
            if (offsetZ > 0.0 && other.maxZ <= this.minZ) {
                offsetZ = Math.min(this.minZ - other.maxZ - WALL_GAP, offsetZ);
            } else if (offsetZ < 0.0 && other.minZ >= this.maxZ) {
                offsetZ = Math.max(this.maxZ - other.minZ + WALL_GAP, offsetZ);
            }
        }
        return offsetZ;
    };
}

// Bug (Mineflayer 4.39): crafting SEVERAL times in the inventory's 2x2 grid (bot.craft(recipe, 2) for
// 6 planks) leaves the bot's view of its inventory wrong. Each craft's last click is not confirmed by
// the server; Mineflayer knows it and resyncs the window after a crafting TABLE (bot._syncWindow, in
// lib/plugins/craft.js), but not after the inventory grid.
// Fix: in the 2x2 grid, craft one time at a time and resync the inventory after each; with a table, resync
// after it; and always once BEFORE the first click (the view may be stale already: a /give, a table just closed).
//
// A resync must wait for the server to be DONE answering, not for the first full inventory packet:
// clicks sent in a burst each carry an old state id, and the server answers some of them with the whole
// inventory too. Seen in the arena (2026-11-12): Mineflayer's own wait (the next inventory packet) ended
// after ~1 ms, on an OLD answer still on its way (a real round trip takes at least one server tick, 50 ms),
// the bot clicked on a stale view (8 planks asked, 4 made), then believed it held planks and hung.
// So: ask, then wait until no packet about this window has come for SYNC_QUIET_MS (the server answers at
// its ticks: 3 ticks of silence = it has nothing left to send), at most SYNC_MAX_MS.
const SYNC_QUIET_MS = 150;
const SYNC_MAX_MS = 2000;
function resyncWindow(bot, window) {
    return new Promise((resolve) => {
        let answered = false;
        let quiet = null;
        const events = ["window_items", "set_slot", "set_player_inventory"];
        const finish = () => {
            clearTimeout(cap);
            clearTimeout(quiet);
            for (const name of events) bot._client.removeListener(name, onPacket);
            resolve(answered);
        };
        const onPacket = function (packet) {
            // set_player_inventory (no window id) is about the player's inventory: window 0
            const id = packet.windowId ?? 0;
            if (id !== window.id) return;
            if (packet.items) answered = true; // a full window (window_items)
            if (!answered) return;
            clearTimeout(quiet);
            quiet = setTimeout(finish, SYNC_QUIET_MS);
        };
        const cap = setTimeout(finish, SYNC_MAX_MS);
        for (const name of events) bot._client.on(name, onPacket);
        // Mineflayer sends the request (a click with an impossible state id); its own wait is not used
        Promise.resolve(bot._syncWindow(window)).catch(() => {});
    });
}

function fixCraftSync(bot) {
    const craft = bot.craft.bind(bot);
    bot.craft = async (recipe, count = 1, craftingTable) => {
        await resyncWindow(bot, bot.inventory); // start from the server's view
        if (craftingTable) {
            // Mineflayer resyncs the table's window itself, with the same too-early wait: resync the
            // inventory once the table is closed (the 2x2 crafts after a table failed in the arena)
            await craft(recipe, count, craftingTable);
            await resyncWindow(bot, bot.inventory);
            return;
        }
        for (let i = 0; i < count; i++) {
            await craft(recipe, 1, craftingTable);
            await resyncWindow(bot, bot.inventory);
        }
    };
}

/* Bug (Mineflayer 4.39): bot.oxygenLevel is set from the air supply of ANY entity whose metadata
arrives (entities.js does not check that it is the bot), so a squid or an axolotl nearby changes it:
the journal had values up to 400 for a 0-20 scale (2026-11-16).
Fix: read the bot's OWN air supply (entity metadata 1, in ticks, 300 = full) and convert it like
Mineflayer does (/ 15 -> 0-20). Not applied in bot.js: observe calls it. null until the server sends it. */
function botOxygen(bot) {
    const air = bot.entity?.metadata?.[1];
    return Number.isFinite(air) ? Math.round(air / 15) : null;
}

export { botOxygen, fixCraftSync, fixDifficulty, fixStateId, fixWallContact, resyncWindow, SYNC_QUIET_MS, WALL_GAP };
