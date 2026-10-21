// The game's own groups of blocks and items ("tags": minecraft:replaceable, minecraft:leaves, minecraft:planks...),
// so that game FACTS come from the game and not from lists written by us. The server sends them
// once when the bot joins (and again after a /reload). Mineflayer does not keep them: we listen
// to the packet ourselves, from bot.js, right after creating the bot (before the packet arrives).
// Lists that are OUR choices (what is worth protecting, what is dangerous...) stay in our code:
// see movements.js.

const blockTags = new WeakMap(); // bot -> { tag name without "minecraft:": Set of block ids }
const itemTags = new WeakMap(); // bot -> { tag name: Set of item ids } (planks, logs, birch_logs...)

function recordTags(bot) {
    bot._client.on("tags", (packet) => {
        for (const registry of packet.tags) {
            const kind = registry.tagType.replace("minecraft:", "");
            if (kind !== "block" && kind !== "item") continue;
            const tags = {};
            for (const t of registry.tags)
                tags[t.tagName.replace("minecraft:", "")] = new Set(t.entries);
            (kind === "block" ? blockTags : itemTags).set(bot, tags);
        }
    });
}

// The ids of the items of a tag ("planks"), or null if the game has no such item tag
const findItemTag = (bot, name) => itemTags.get(bot)?.[name] ?? null;

// The game's item group that is EXACTLY this set of item names ("#planks"), or null. Used to name
// the variants of a recipe as the game's own recipe does (the crafting table: 4 x #planks).
function itemGroupOf(bot, names) {
    const ids = new Set(names.map((n) => bot.registry.itemsByName[n]?.id));
    const matches = Object.entries(itemTags.get(bot) ?? {})
        .filter(([, tag]) => tag.size === ids.size && [...tag].every((id) => ids.has(id)))
        .map(([name]) => name)
        .sort((a, b) => a.length - b.length || a.localeCompare(b)); // the plainest name first
    return matches.length > 0 ? `#${matches[0]}` : null;
}

// The ids of the blocks of a tag (e.g. "replaceable"). Throws if the server did not send it:
// a skill then fails with reason "exception" instead of guessing.
function blockTag(bot, name) {
    const tag = blockTags.get(bot)?.[name];
    if (!tag) throw new Error(`block tag minecraft:${name} not received from the server`);
    return tag;
}

// The same, or null if the game has no such tag (for a name given by the LLM: '#logs')
const findBlockTag = (bot, name) => blockTags.get(bot)?.[name] ?? null;

// Is this block (from bot.blockAt) in the tag?
const inBlockTag = (bot, name, block) => blockTag(bot, name).has(block.type);

export { blockTag, findBlockTag, findItemTag, inBlockTag, itemGroupOf, recordTags };
