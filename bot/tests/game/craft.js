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
