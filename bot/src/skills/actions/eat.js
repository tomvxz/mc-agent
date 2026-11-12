import { waitUntil } from "./utils.js";

// Foods never picked automatically (poison, teleportation...)
const AVOID = [
    "rotten_flesh",
    "spider_eye",
    "poisonous_potato",
    "pufferfish",
    "chorus_fruit",
    "suspicious_stew",
];

async function eat(bot, { food } = {}) {
    const foods = bot.registry.foodsByName;

    // 1. If a specific food is requested, it must exist
    if (food !== undefined) {
        if (typeof food !== "string")
            return {
                success: false,
                reason: "invalid_args",
                details: { food },
            };
        if (!foods[food])
            return {
                success: false,
                reason: "unknown_item",
                details: { food },
            };
    }

    // 2. Eating is impossible when the hunger bar is full
    const before = bot.food;
    if (before >= 20)
        return {
            success: false,
            reason: "not_hungry",
            details: { food_before: before },
        };

    // 3. Pick from the inventory: the requested food, otherwise the most nourishing one
    const candidates = bot.inventory
        .items()
        .filter((i) =>
            food ? i.name === food : foods[i.name] && !AVOID.includes(i.name),
        );
    if (candidates.length === 0)
        return {
            success: false,
            reason: "no_food",
            details: { food, food_before: before },
        };
    candidates.sort(
        (a, b) =>
            foods[b.name].effectiveQuality - foods[a.name].effectiveQuality,
    );
    const choice = candidates[0];

    try {
        // 4. Hold it and eat it
        await bot.equip(choice, "hand");
        await bot.consume();
    } catch (e) {
        return {
            success: false,
            reason: "eat_failed",
            details: {
                food: choice.name,
                food_before: before,
                error: e.message,
            },
        };
    }

    // 5. Check that hunger really went up (the server may answer a little later)
    await waitUntil(() => bot.food > before, 1000);
    if (bot.food <= before) {
        return {
            success: false,
            reason: "eat_failed",
            details: {
                food: choice.name,
                food_before: before,
                food_after: bot.food,
            },
        };
    }
    return {
        success: true,
        reason: "ok",
        details: {
            food: choice.name,
            food_before: before,
            food_after: bot.food,
        },
    };
}

export default eat;
