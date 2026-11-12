import craft from "../../src/skills/actions/craft.js";
import { CENTER as C, giveAndWait, placeAndWait } from "./arena.js";

// Give a list of items: { oak_log: 3 }
const give = (items) => async (bot) => {
    for (const [name, n] of Object.entries(items)) await giveAndWait(bot, name, n);
};

// Check in the real inventory that at least n items were gained
const gained = (name, n) => (r, before, after) => {
    const delta = (after.inventory[name] || 0) - (before.inventory[name] || 0);
    return delta >= n || `${name} +${delta}`;
};

const nominal = [
    {
        name: "planks (2x2)",
        setup: give({ oak_log: 1 }),
        args: { item: "oak_planks", count: 4 },
        verify: gained("oak_planks", 4),
    },
    {
        // 2 crafts in one call (8 planks from 2 logs): the inventory seen by the bot must be right
        // (src/game/fixes.js, fixCraftSync)
        name: "planks x8 (2 crafts in the 2x2 grid)",
        setup: give({ oak_log: 2 }),
        args: { item: "oak_planks", count: 8 },
        verify: (r, before, after) =>
            ((after.inventory.oak_planks || 0) - (before.inventory.oak_planks || 0) === 8 && !after.inventory.oak_log) ||
            `planks +${(after.inventory.oak_planks || 0) - (before.inventory.oak_planks || 0)}, logs left ${after.inventory.oak_log || 0}`,
    },
    {
        name: "sticks (2x2)",
        setup: give({ oak_planks: 2 }),
        args: { item: "stick", count: 4 },
        verify: gained("stick", 4),
    },
    {
        name: "table (2x2)",
        setup: give({ oak_planks: 4 }),
        args: { item: "crafting_table" },
        verify: gained("crafting_table", 1),
    },
    {
        name: "wooden pickaxe (3x3, table 6 blocks away)",
        setup: async (bot) => {
            await give({ oak_planks: 3, stick: 2 })(bot);
            await placeAndWait(
                bot,
                `/setblock ${C.x + 6} ${C.y} ${C.z + 2} crafting_table`,
                [C.x + 6, C.y, C.z + 2],
                "crafting_table",
            );
        },
        args: { item: "wooden_pickaxe" },
        verify: gained("wooden_pickaxe", 1),
    },
    {
        // Seen 2026-11-12: right after a craft at a table, crafts in the 2x2 grid failed (4 planks of 8, then
        // crafts that hung): the inventory seen by the bot was stale (src/game/fixes.js, resyncWindow). The setup
        // crafts at a table (a direct call: not a trial), then the trial is planks x8 in the 2x2 grid.
        name: "planks x8 right after a craft at a table",
        setup: async (bot) => {
            await give({ oak_planks: 3, stick: 2, oak_log: 2 })(bot);
            await placeAndWait(
                bot,
                `/setblock ${C.x + 2} ${C.y} ${C.z + 2} crafting_table`,
                [C.x + 2, C.y, C.z + 2],
                "crafting_table",
            );
            const r = await craft(bot, { item: "wooden_pickaxe" });
            if (!r.success) throw new Error(`table craft in the setup: ${r.reason}`);
        },
        args: { item: "oak_planks", count: 8 },
        verify: (r, before, after) =>
            ((after.inventory.oak_planks || 0) - (before.inventory.oak_planks || 0) === 8 && !after.inventory.oak_log) ||
            `planks +${(after.inventory.oak_planks || 0) - (before.inventory.oak_planks || 0)}, logs left ${after.inventory.oak_log || 0}`,
    },
];

const edgeCases = [
    { name: "missing ingredients", args: { item: "stick" }, expect: "missing_ingredients" },
    {
        name: "no table around",
        setup: give({ oak_planks: 3, stick: 2 }),
        args: { item: "wooden_pickaxe" },
        expect: "no_crafting_table",
    },
    { name: "item without a recipe", args: { item: "dirt" }, expect: "no_recipe" },
    { name: "unknown item", args: { item: "no_such_item" }, expect: "unknown_item" },
];

export const skill = "craft";
export { edgeCases, nominal };
