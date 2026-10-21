// Question: how is an item crafted? (changes nothing in the world, like find)
// Strictly one level, like one page of the game's recipe book: the ingredients of one craft, how many
// items it makes, whether a crafting table is needed. Nothing about how to get the ingredients: the
// LLM asks again for an ingredient (no_recipe = gathered, not crafted) and composes the chain itself.
import { recipeNeeds } from "./craft.js";

async function recipe(bot, { item } = {}) {
    if (typeof item !== "string")
        return { success: false, reason: "invalid_args", details: { item } };
    const info = bot.registry.itemsByName[item];
    if (!info) return { success: false, reason: "unknown_item", details: { item } };
    if (bot.recipesAll(info.id, null, true).length === 0)
        return { success: false, reason: "no_recipe", details: { item } };

    // count 1 = the ingredients of ONE craft (which may make several items: details.makes)
    const needs = recipeNeeds(bot, info, 1);
    return { success: true, reason: "ok", details: { item, ...needs } };
}

export default recipe;
