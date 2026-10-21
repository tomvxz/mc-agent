import mineflayerPathfinder from "mineflayer-pathfinder";
import {
    dropsNear,
    gainedSince,
    gotoWatched,
    inventoryCounts,
    makeVec3,
    movementFailureReason,
    walkSeconds,
} from "./utils.js";
import { inBlockTag } from "../tags.js";
const { goals } = mineflayerPathfinder;

const LIQUIDS = ["water", "lava"]; // with the game's tag minecraft:air: nothing to break there
const QUICK_HARDNESS = 0.25; // breaks almost instantly: leaves 0.2, tall grass 0, snow 0.1, vines 0.2
const MAX_CLEARED = 6; // at most this many blocks broken just to see the target
// Look at the faces of the target turned towards the bot (at most 3, like Mineflayer's
// dig(..., 'raycast')) and return, for each, the first block on the line of sight from the eyes
// to the middle of the face: the target itself if that face is visible. Aiming at faces and not at
// the center matters: a log of a trunk is hidden at its center by the log below, but a player
// still sees (or uncovers) its side face.
function facesSeen(bot, target) {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
    const center = target.offset(0.5, 0.5, 0.5);
    const delta = {
        x: eye.x - center.x,
        y: eye.y - center.y,
        z: eye.z - center.z,
    };
    const hits = [];
    for (const axis of ["y", "x", "z"]) {
        if (Math.abs(delta[axis]) <= 0.5) continue; // this face is turned away from the bot
        const side = Math.sign(delta[axis]) * 0.5;
        const face = center.offset(
            axis === "x" ? side : 0,
            axis === "y" ? side : 0,
            axis === "z" ? side : 0,
        );
        const dir = face.minus(eye);
        const length = dir.norm(); // read BEFORE normalize(): Vec3's normalize changes the vector itself
        hits.push(bot.world.raycast(eye, dir.normalize(), length + 0.5));
    }
    return hits;
}

// Is at least one face of the target visible?
const someFaceVisible = (bot, target) =>
    facesSeen(bot, target).some((hit) => hit && hit.position.equals(target));

// A block worth breaking just to see behind it: almost instant to break (the game's hardness, no
// list of names) and not protected (chest, door... see movements.js)
function quickToBreak(bot, block) {
    return (
        block.diggable &&
        block.hardness !== null &&
        block.hardness <= QUICK_HARDNESS &&
        bot.pathfinder.movements.safeToBreak(block)
    );
}

// Get where a face of the block is visible and within reach, like a player:
// 1. change viewpoint (the pathfinder looks for a place from which the block is visible);
// 2. ONLY if there is none: walk next to it and break what hides a face, if it breaks almost
//    instantly. Example: a log inside a tree crown has leaves on its 4 sides and logs above and
//    below, no viewpoint exists (measured: no_path without this step).
// Returns the number of blocks broken to see the target and the last movement error.
async function getInView(bot, target, ready) {
    const look = () =>
        gotoWatched(bot, new goals.GoalLookAtBlock(target, bot.world));
    let moveError = null;
    try {
        await look();
    } catch (e) {
        moveError = e;
    }
    let cleared = 0;
    if (ready()) return { cleared, moveError: null };
    try {
        await gotoWatched(
            bot,
            new goals.GoalNear(target.x, target.y, target.z, 2),
        );
    } catch (e) {
        return { cleared, moveError: moveError || e };
    }
    while (!ready() && cleared < MAX_CLEARED) {
        const hider = facesSeen(bot, target).find(
            (hit) =>
                hit &&
                !hit.position.equals(target) &&
                quickToBreak(bot, hit) &&
                bot.canDigBlock(hit),
        );
        if (!hider) break;
        try {
            await bot.dig(hider);
        } catch (e) {
            break; // e.g. "Digging aborted": stop clearing, the dig of the target says if it worked
        }
        cleared++;
    }
    if (cleared > 0 && !ready()) {
        // Something was cleared but the face is not visible from here yet: try a viewpoint again
        try {
            await look();
            moveError = null;
        } catch (e) {
            moveError = e;
        }
    }
    return { cleared, moveError };
}

// Break the block at a position, and only that (to also get the items: collect_block). The bot
// walks to a place where it sees the block; if there is none, it breaks leaves or tall grass hiding it.
// require_tool (default true): refuse a block that drops nothing without the right tool (stone without a
// pickaxe); false = break it anyway, like a player clearing a way: slower, and nothing drops (no_drop).
async function break_block(bot, { x, y, z, require_tool = true } = {}) {
    // 1. Check the arguments
    if (![x, y, z].every(Number.isInteger) || typeof require_tool !== "boolean")
        return { success: false, reason: "invalid_args", details: { x, y, z, require_tool } };
    const position = [x, y, z];
    const target = makeVec3(bot, x, y, z);

    // 2. What is at this position?
    const block = bot.blockAt(target);
    if (!block)
        return { success: false, reason: "not_loaded", details: { position } };
    if (inBlockTag(bot, "air", block) || LIQUIDS.includes(block.name))
        return {
            success: false,
            reason: "nothing_to_break",
            details: { position, block: block.name },
        };
    if (!block.diggable)
        return {
            success: false,
            reason: "unbreakable",
            details: { position, block: block.name },
        };

    // 3. Some blocks require a tool (stone needs a pickaxe), otherwise they drop nothing
    const noDrop =
        !!block.harvestTools &&
        !bot.inventory.items().some((i) => block.harvestTools[i.type]);
    if (noDrop && require_tool) {
        const tools = Object.keys(block.harvestTools).map(
            (id) => bot.registry.items[id].name,
        );
        return {
            success: false,
            reason: "no_tool",
            details: { position, block: block.name, tools },
        };
    }

    // 4. Get close enough to SEE and reach the block (a visible face, see facesSeen). Being in range
    //    is not enough: otherwise the bot breaks through a wall and the item stays behind it.
    const ready = () =>
        bot.canDigBlock(bot.blockAt(target)) && someFaceVisible(bot, target);
    let cleared = 0;
    if (!ready()) {
        const view = await getInView(bot, target, ready);
        cleared = view.cleared;
        if (!ready()) {
            const e = view.moveError;
            return {
                success: false,
                reason: e ? movementFailureReason(e) : "no_path",
                details: {
                    position,
                    block: block.name,
                    cleared,
                    error: e ? e.message : "cannot see the block",
                },
            };
        }
    }

    const before = inventoryCounts(bot);
    try {
        // 5. Take the best tool (none if bare hands are enough) and dig
        const tool = bot.pathfinder.bestHarvestTool(block);
        if (tool) await bot.equip(tool, "hand");
        await bot.dig(bot.blockAt(target), true, "raycast"); // look at (and dig) a visible face
    } catch (e) {
        return {
            success: false,
            reason: "dig_failed",
            details: { position, block: block.name, error: e.message },
        };
    }

    // 6. Check that the block is gone, and note what fell (pick_up gets it; collect_block does both)
    const after = bot.blockAt(target);
    if (after && after.type === block.type) {
        return {
            success: false,
            reason: "dig_failed",
            details: { position, block: block.name },
        };
    }
    const drops = await dropsNear(bot, target);
    // drops may be empty: leaves or glass often drop nothing, and an item landing next to the bot
    // is picked up at once by the game (then it is in `collected`)
    return {
        success: true,
        reason: "ok",
        details: {
            position,
            block: block.name,
            drops,
            collected: gainedSince(bot, before),
            ...(cleared && { cleared }),
            ...(noDrop && { no_drop: true }), // broken without the right tool: nothing could drop
        },
    };
}

// Estimated duration, for its time budget (runSkill.js): walking there + the game's digging time with
// the best tool of the inventory (obsidian by hand: minutes, refused as too_long before starting)
function digSeconds(bot, { x, y, z }) {
    const block = bot.blockAt(makeVec3(bot, x, y, z));
    if (!block) return 0;
    const tool = bot.pathfinder.bestHarvestTool(block);
    return block.digTime(tool ? tool.type : null, false, false, false, [], {}) / 1000;
}
break_block.budget = (bot, args) => walkSeconds(bot, args.x, args.y, args.z) + digSeconds(bot, args);

export default break_block;
export { digSeconds };
