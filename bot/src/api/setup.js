// Put the bot in a known starting situation
// Not a skill: it uses server commands, it is never shown to the LLM and it is not
// logged as a transition.

import { runCommand } from "../game/commands.js";
import { findBlockTag } from "../game/tags.js";
import { setPerception } from "../observation/perception.js";
import { sleep, waitUntil } from "../skills/utils.js";

/**
Teleport the bot onto the ground at column (x, z), then set its inventory 
to exactly `inventory` ({ item: count }). 

perception (optional): "sight" or "all", for the skills that follow.
count_blocks (optional): block names or game groups ("#logs") to count within 32 blocks, 
ALL that the client knows for diagnostic purposes.

Returns { success, reason, details }.
*/
async function setupPlace(bot, { x, z, inventory = {}, perception, count_blocks = [] }) {
    if (perception !== undefined) setPerception(perception);
    // The server's answer says why it refused (e.g. no safe ground there: water, lava)
    const answer = await runCommand(
        bot,
        `/spreadplayers ${x} ${z} 0 1 false ${bot.username}`,
        5000,
    );
    // Refused (no safe ground in the 3x3 area): fail now
    if (answer && answer.startsWith("Could not spread"))
        return { success: false, reason: "not_moved", details: { x, z, server_answer: answer } };
    // Arrived = near the column (spreadplayers puts it on the highest solid block there)
    const near = () => {
        const p = bot.entity.position;
        return Math.hypot(p.x - x - 0.5, p.z - z - 0.5) < 3;
    };
    if (!(await waitUntil(near, 10000)))
        return { success: false, reason: "not_moved", details: { x, z, server_answer: answer } };
    await Promise.race([bot.waitForChunksToLoad(), sleep(15000)]);
    await runCommand(bot, `/clear ${bot.username}`);
    for (const [item, count] of Object.entries(inventory))
        await runCommand(bot, `/give ${bot.username} ${item} ${count}`);
    await runCommand(bot, "/time set day");
    await runCommand(bot, "/weather clear");
    await sleep(2000); // let the terrain and the server settle
    const p = bot.entity.position;
    const blocks = {};
    for (const name of count_blocks) {
        const ids = name.startsWith("#")
            ? [...(findBlockTag(bot, name.slice(1)) ?? [])]
            : [bot.registry.blocksByName[name].id];
        blocks[name] = bot.findBlocks({ matching: ids, maxDistance: 32, count: 5000 }).length;
    }
    return {
        success: true,
        reason: "ok",
        details: {
            position: [p.x, p.y, p.z].map((v) => Math.round(v * 10) / 10),
            ...(count_blocks.length > 0 && { blocks_within_32: blocks }),
        },
    };
}

export { setupPlace };
