// Question: the recipe book (changes nothing in the world, like find). Strictly ONE level, both ways:
//   item: how is it crafted? The ingredients of one craft, how many items it makes, whether a crafting
//         table is needed. Variants are named with the game's group when they are one ("#planks").
//         A group ("#planks"): the recipe of each of its items (birch_planks <- birch_log...).
//   uses: what is crafted DIRECTLY from it? (an item or a group: "birch_log", "#logs"), like the
//         "usage" section of the wiki.
// Nothing about how to get an ingredient, nothing deeper: the LLM asks again and composes the chain.
import { findItemTag } from "../tags.js";
import { recipeNeeds } from "./craft.js";

// The item ids of a name: an item, or a game group of items ("#planks"); null if neither
function itemIds(bot, name) {
    if (name.startsWith("#")) {
        const tag = findItemTag(bot, name.slice(1));
        return tag ? [...tag] : null;
    }
    const info = bot.registry.itemsByName[name];
    return info ? [info.id] : null;
}

// The ingredient ids of one recipe of the game data (shaped: inShape, shapeless: ingredients)
const ingredientIds = (r) =>
    (r.inShape ? r.inShape.flat() : r.ingredients || []).map((x) => (typeof x === "object" && x ? x.id : x)).filter((x) => x != null && x >= 0);
// A 3x3 recipe needs a crafting table (wider or taller than 2, or more than 4 ingredients)
const needsTable = (r) =>
    r.inShape ? r.inShape.length > 2 || r.inShape.some((row) => row.length > 2) : (r.ingredients || []).length > 4;

async function recipe(bot, { item, uses } = {}) {
    // 1. Exactly one of item / uses, a string
    const asked = item ?? uses;
    if (typeof asked !== "string" || (item !== undefined && uses !== undefined))
        return { success: false, reason: "invalid_args", details: { item, uses } };
    const ids = itemIds(bot, asked);
    if (!ids) return { success: false, reason: "unknown_item", details: { item: asked } };

    // 2a. uses: every item crafted directly from one of these
    if (uses !== undefined) {
        const wanted = new Set(ids);
        const used_in = [];
        for (const [resultId, list] of Object.entries(bot.registry.recipes || {})) {
            const r = list.find((x) => ingredientIds(x).some((id) => wanted.has(id)));
            if (!r) continue;
            used_in.push({ item: bot.registry.items[resultId].name, makes: r.result.count, needs_table: needsTable(r) });
        }
        if (used_in.length === 0) return { success: false, reason: "no_use", details: { uses } };
        return { success: true, reason: "ok", details: { uses, used_in } };
    }

    // 2b. item: its recipe (one craft); a group: the recipe of each of its items
    const recipes = ids
        .map((id) => bot.registry.items[id])
        .filter((info) => bot.recipesAll(info.id, null, true).length > 0)
        // count 1 = the ingredients of ONE craft (which may make several items: makes)
        .map((info) => ({ item: info.name, ...recipeNeeds(bot, info, 1) }));
    if (recipes.length === 0) return { success: false, reason: "no_recipe", details: { item } };
    if (!item.startsWith("#")) return { success: true, reason: "ok", details: recipes[0] };
    return { success: true, reason: "ok", details: { group: item, recipes } };
}

export default recipe;
