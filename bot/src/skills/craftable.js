// Question: what can be crafted NOW with the inventory? Like the recipe book's "show craftable" filter
// (changes nothing in the world). One level: only what the inventory already allows, nothing about
// what it would take to make more. now = in the 2x2 grid of the inventory; with_table = needs a
// crafting table (table_near: one within 32 blocks, that craft walks to).

async function craftable(bot) {
    const now = [];
    const withTable = [];
    for (const id of Object.keys(bot.registry.recipes || {}).map(Number)) {
        const name = bot.registry.items[id].name;
        const small = bot.recipesFor(id, null, 1, null);
        if (small.length > 0) {
            now.push({ item: name, makes: small[0].result.count });
            continue;
        }
        const big = bot.recipesFor(id, null, 1, true);
        if (big.length > 0) withTable.push({ item: name, makes: big[0].result.count });
    }
    const table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 });
    if (now.length === 0 && withTable.length === 0)
        return { success: false, reason: "nothing_craftable", details: { table_near: !!table } };
    return {
        success: true,
        reason: "ok",
        details: { now, with_table: withTable, table_near: !!table },
    };
}

export default craftable;
