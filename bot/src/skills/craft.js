import move_to from "./move_to.js";
import { waitUntil } from "./utils.js";

// What a recipe needs, like the game's recipe book shows it to a player: for the recipe(s) the bot
// is closest to being able to make, each ingredient's required and owned count, how many items one
// craft makes, and whether a crafting table is needed. STRICTLY ONE LEVEL: what X needs, never how
// to get the ingredients (the LLM asks recipe again for an ingredient). Tried and removed: a `how`
// per ingredient, and showing only the planks of the wood around; both answered the next question
// before it was asked (the body itself linked logs -> planks).
// For now every recipe is known (Mineflayer's data); later a memory may filter them to the ones the
// agent has met (see CLAUDE.md, Mémoire).
// Many recipes accept variants (any planks for a pickaxe): equivalent recipes are merged into one
// ingredient like any_planks: { required: 3, owned: 0, one_of: ['oak_planks', ...] }.
function recipeNeeds(bot, info, count) {
    try {
        return describeNeeds(bot, info, count);
    } catch (e) {
        return {}; // only informative: never let it hide the real failure reason
    }
}

function describeNeeds(bot, info, count) {
    const options = [];
    for (const recipe of bot.recipesAll(info.id, null, true)) {
        const times = Math.ceil(count / recipe.result.count);
        const ingredients = {};
        let missing = 0;
        for (const d of recipe.delta) {
            if (d.count >= 0 || d.id === info.id) continue; // the delta also lists the result itself
            const name = bot.registry.items[d.id].name;
            const required = -d.count * times;
            const owned = bot.inventory.count(d.id, null);
            ingredients[name] = { required, owned };
            missing += Math.max(0, required - owned);
        }
        options.push({
            missing,
            needs_table: !!recipe.requiresTable,
            makes: recipe.result.count,
            ingredients,
        });
    }
    if (options.length === 0) return {};
    const least = Math.min(...options.map((o) => o.missing));
    const best = options.filter((o) => o.missing === least);
    if (best.length === 1) {
        return {
            needs_table: best[0].needs_table,
            makes: best[0].makes,
            ingredients: best[0].ingredients,
        };
    }

    // Several equally close recipes: keep what they share, merge what varies (e.g. the planks type)
    const shared = Object.keys(best[0].ingredients).filter((n) =>
        best.every((o) => o.ingredients[n]),
    );
    const ingredients = Object.fromEntries(
        shared.map((n) => [n, best[0].ingredients[n]]),
    );
    const variants = {};
    for (const o of best) {
        for (const [name, need] of Object.entries(o.ingredients)) {
            if (shared.includes(name)) continue;
            const group =
                variants[need.required] ||
                (variants[need.required] = {
                    required: need.required,
                    owned: 0,
                    one_of: [],
                });
            if (!group.one_of.includes(name)) group.one_of.push(name);
            group.owned = Math.max(group.owned, need.owned);
        }
    }
    for (const group of Object.values(variants))
        ingredients[variantKey(group.one_of)] = group;
    return { needs_table: best.every((o) => o.needs_table), makes: best[0].makes, ingredients };
}

// "any_planks" for [oak_planks, spruce_planks, ...]: named after the most common last word
// (one_of stays the exact list, e.g. sticks can also be made from bamboo)
function variantKey(names) {
    const counts = {};
    for (const n of names) {
        const last = n.slice(n.lastIndexOf("_") + 1);
        counts[last] = (counts[last] || 0) + 1;
    }
    const [word] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return `any_${word}`;
}

async function craft(bot, { item, count = 1 } = {}) {
    // 1. Check the arguments
    if (typeof item !== "string" || !Number.isInteger(count) || count < 1) {
        return {
            success: false,
            reason: "invalid_args",
            details: { item, count },
        };
    }
    const info = bot.registry.itemsByName[item];
    if (!info)
        return { success: false, reason: "unknown_item", details: { item } };

    // 2. Does this item have a recipe at all? (true = "assuming we have a table")
    if (bot.recipesAll(info.id, null, true).length === 0) {
        return { success: false, reason: "no_recipe", details: { item } };
    }

    // 3. A recipe doable with the inventory, first without a table (2x2 grid)
    let table = null;
    let recipes = bot.recipesFor(info.id, null, count, null);
    if (recipes.length === 0) {
        // Otherwise with a table (3x3 grid): do we have the ingredients?
        recipes = bot.recipesFor(info.id, null, count, true);
        if (recipes.length === 0) {
            return {
                success: false,
                reason: "missing_ingredients",
                details: { item, count, ...recipeNeeds(bot, info, count) },
            };
        }

        table = bot.findBlock({
            matching: bot.registry.blocksByName.crafting_table.id,
            maxDistance: 32,
        });
        if (!table)
            return {
                success: false,
                reason: "no_crafting_table",
                details: { item, ...recipeNeeds(bot, info, count) },
            };

        // Walk to the table with the move_to skill
        const p = table.position;
        const walk = await move_to(bot, { x: p.x, y: p.y, z: p.z, range: 3 });
        if (!walk.success)
            return {
                success: false,
                reason: walk.reason,
                details: { item, ...walk.details },
            };
    }

    // 4. Craft: a recipe sometimes yields several items (1 log = 4 planks)
    const recipe = recipes[0];
    const times = Math.ceil(count / recipe.result.count);
    const before = bot.inventory.count(info.id, null);
    const crafted = () => bot.inventory.count(info.id, null) - before;
    try {
        await bot.craft(recipe, times, table);
    } catch (e) {
        return {
            success: false,
            reason: "craft_failed",
            details: { item, error: e.message },
        };
    }

    // 5. Check the inventory (the update arrives a little later)
    if (!(await waitUntil(() => crafted() >= count, 1000))) {
        return {
            success: false,
            reason: "craft_failed",
            details: { item, crafted: crafted() },
        };
    }
    return {
        success: true,
        reason: "ok",
        details: { item, crafted: crafted() },
    };
}

export default craft;
export { recipeNeeds };
