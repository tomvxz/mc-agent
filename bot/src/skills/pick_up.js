import {
    droppedItem,
    gainedSince,
    inventoryCounts,
    itemsOnGround,
    movementFailureReason,
    walkOnto,
} from "./utils.js";

const MAX_ITEMS = 10; // at most this many items picked up in one call

// Pick up the items lying on the ground near the bot: all of them, or only those of one type.
// Useful after break_block, or when a killed animal or another player drops something.
async function pick_up(bot, { item, max_distance = 8 } = {}) {
    // 1. Check the arguments
    if (item !== undefined && typeof item !== "string")
        return { success: false, reason: "invalid_args", details: { item } };
    if (item !== undefined && !bot.registry.itemsByName[item])
        return { success: false, reason: "unknown_item", details: { item } };
    if (
        !Number.isFinite(max_distance) ||
        max_distance <= 0 ||
        max_distance > 32
    ) {
        return {
            success: false,
            reason: "invalid_args",
            details: { max_distance },
        };
    }

    // 2. Which items are there?
    const around = () =>
        itemsOnGround(bot, bot.entity.position, max_distance).filter(
            (e) => item === undefined || droppedItem(e)?.name === item,
        );
    const found = around();
    if (found.length === 0)
        return {
            success: false,
            reason: "nothing_to_pick_up",
            details: { item: item ?? null, max_distance },
        };

    // 3. Walk onto each one, nearest first
    const before = inventoryCounts(bot);
    let moveError = null;
    for (const entity of found.slice(0, MAX_ITEMS)) {
        if (!bot.entities[entity.id]) continue; // already picked up on the way
        try {
            await walkOnto(bot, entity);
        } catch (e) {
            moveError = e; // unreachable: try the next one
        }
    }

    // 4. What really reached the inventory?
    const collected = gainedSince(bot, before);
    const left = around().length;
    if (Object.keys(collected).length === 0) {
        const reason = moveError
            ? movementFailureReason(moveError)
            : "not_collected";
        return {
            success: false,
            reason,
            details: {
                collected,
                left,
                ...(moveError && { error: moveError.message }),
            },
        };
    }
    if (left > 0)
        return {
            success: false,
            reason: "partial",
            details: { collected, left },
        };
    return { success: true, reason: "ok", details: { collected } };
}

export default pick_up;
