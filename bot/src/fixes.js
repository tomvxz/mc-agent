// Fixes for Mineflayer bugs, applied once in bot.js.
// We never edit node_modules (versions are pinned): we fix things from our own code.

import AABB from "prismarine-physics/lib/aabb.js"; // the physics' collision box class (same instance as Mineflayer's)

// Bug (Mineflayer 4.39, server 1.21.11): each window (inventory = 0, crafting table = 1, 2...)
// has its own "stateId" counter, but Mineflayer keeps a single one for all of them. When the
// server updates the inventory while a table is open, clicks are sent with the inventory's
// counter; the server then resends the whole window, Mineflayer resyncs to a stale state and
// makes wrong clicks: about 1 table craft in 2 failed.
// Fix: remember the latest stateId of EACH window and put it back into the clicks.
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

// Bug (Mineflayer 4.39, protocol 1.21.11): the "difficulty" packet already arrives decoded as text
// ("easy"), but Mineflayer translates it again with its own table (names[number]), which gives
// undefined: bot.game.difficulty is never set. Mineflayer's listener is installed AFTER ours (its
// plugins load a bit later), so the fix is applied once every listener has run (queueMicrotask).
function fixDifficulty(bot) {
    const NAMES = ["peaceful", "easy", "normal", "hard"];
    bot._client.on("difficulty", (packet) => {
        const d = packet.difficulty;
        queueMicrotask(() => {
            bot.game.difficulty = typeof d === "string" ? d : NAMES[d];
        });
    });
}

// Bug (prismarine-physics 1.11, used by Mineflayer, against Paper 1.21.11): when the bot walks into
// a wall, the physics puts its box EXACTLY against the block face. Paper counts that exact contact
// as a collision and silently sends the bot back (a "position" packet) ; the bot pushes again, and
// so on every tick: it stays frozen against the wall. In natural terrain this happens all the time
// (bumping into a step before jumping on it, a trunk, leaves at head height): on the first field
// bench, 16/18 move_to and 18/19 explore failed with "stuck" and ~15 corrections per second.
// Reproduced in the arena with any block (leaves, stone, at head or feet height), in a 1-wide
// corridor and walking diagonally into a corner. Measured threshold: a gap of 1e-9 block still
// gets corrected, 1e-6 does not, which matches Paper's collision tolerance (1e-7). 1 mm is
// ~10 000 times that margin, still invisible in the game. Ceilings are not affected (tested).
// Fix: when a horizontal move (x or z) is stopped by a block, stop 1 mm before its face. Vertical
// moves are not changed (standing exactly on the ground is normal and accepted).
// This changes the shared physics class, so it is done once for the whole program.
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

export { fixDifficulty, fixStateId, fixWallContact, WALL_GAP };
