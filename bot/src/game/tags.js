// The game's own groups of blocks and items ("tags": leaves, planks, replaceable...), read from the
// packet the server sends at login. Game facts come from the game, not from lists of ours (our
// choices, like what to protect, are in movements.js).
// Mineflayer does not keep this packet: bot.js calls recordTags right after creating the bot.

const blockTags = new WeakMap(); // bot -> { tag name: Set of block ids }
const itemTags = new WeakMap(); // bot -> { tag name: Set of item ids }
// bot -> Set of fluid tag names ("water", "lava"). The packet gives ids of a fluid registry that
// Mineflayer does not have, so only the names are kept: a fluid block is named like its tag.
const fluidTags = new WeakMap();

// Listen to the tags packet. Names are stored without the "minecraft:" prefix.
function recordTags(bot) {
    bot._client.on("tags", (packet) => {
        for (const registry of packet.tags) {
            const kind = registry.tagType.replace("minecraft:", "");
            if (kind === "fluid")
                fluidTags.set(
                    bot,
                    new Set(registry.tags.map((t) => t.tagName.replace("minecraft:", ""))),
                );
            if (kind !== "block" && kind !== "item") continue;
            const tags = {};
            for (const t of registry.tags)
                tags[t.tagName.replace("minecraft:", "")] = new Set(t.entries);
            (kind === "block" ? blockTags : itemTags).set(bot, tags);
        }
    });
}

// The item ids of a tag ("planks"), or null if the tag does not exist
const findItemTag = (bot, name) => itemTags.get(bot)?.[name] ?? null;

// The name of the item group that is EXACTLY this set of items ("#planks"), or null.
// Used to write a recipe like the game does (4 x #planks). Several matches: the shortest name.
function itemGroupOf(bot, names) {
    const ids = new Set(names.map((n) => bot.registry.itemsByName[n]?.id));
    const matches = Object.entries(itemTags.get(bot) ?? {})
        .filter(([, tag]) => tag.size === ids.size && [...tag].every((id) => ids.has(id)))
        .map(([name]) => name)
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
    return matches.length > 0 ? `#${matches[0]}` : null;
}

// The block ids of a tag ("replaceable"). Throws if the server did not send it: the skill fails
// ("exception") instead of guessing. For a name that may be wrong, use findBlockTag.
function blockTag(bot, name) {
    const tag = blockTags.get(bot)?.[name];
    if (!tag) throw new Error(`block tag minecraft:${name} not received from the server`);
    return tag;
}

// Same, but null if the tag does not exist (for a name given by the LLM, like "#logs")
const findBlockTag = (bot, name) => blockTags.get(bot)?.[name] ?? null;

// Is this block (from bot.blockAt) in the tag? Throws like blockTag.
const inBlockTag = (bot, name, block) => blockTag(bot, name).has(block.type);

// Is this block a fluid (water, lava)? Not from minecraft-data, which marks them as diggable.
// Throws if the fluid tags were not received.
// Our only name: a bubble column is water for the game, but nothing sent to the client says so.
const WATER_BLOCKS = ["bubble_column"];
function isFluid(bot, block) {
    const names = fluidTags.get(bot);
    if (!names) throw new Error("fluid tags not received from the server");
    return names.has(block.name) || (names.has("water") && WATER_BLOCKS.includes(block.name));
}

export { blockTag, findBlockTag, findItemTag, inBlockTag, isFluid, itemGroupOf, recordTags };
