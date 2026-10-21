// Shortcut: break the block at a position AND pick up what drops = break_block + pick_up.
// The two are almost always wanted together: one call saves the LLM a step.
import break_block from "./break_block.js";
import pick_up from "./pick_up.js";
import { gainedSince, inventoryCounts } from "./utils.js";

async function collect_block(bot, args = {}) {
    const before = inventoryCounts(bot);

    // 1. Break it (break_block checks the arguments, walks there and reports what fell)
    const broken = await break_block(bot, args);
    if (!broken.success) return broken;

    // 2. Pick up what fell (by type; a drop of unknown type: pick up everything around)
    const { position, block, drops, cleared } = broken.details;
    const names = [...new Set(drops.map((d) => d.name))];
    for (const name of names)
        await pick_up(bot, name === null ? {} : { item: name });

    // 3. What really reached the inventory? (some blocks drop nothing: leaves, glass...)
    const details = {
        position,
        block,
        drops,
        collected: gainedSince(bot, before),
        ...(cleared && { cleared }), // blocks broken only to see the target (break_block)
    };
    if (drops.length > 0 && Object.keys(details.collected).length === 0) {
        return { success: false, reason: "not_collected", details };
    }
    return { success: true, reason: "ok", details };
}

export default collect_block;
