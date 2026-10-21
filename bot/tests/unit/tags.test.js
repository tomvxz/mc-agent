import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { blockTag, findItemTag, inBlockTag, itemGroupOf, recordTags } from "../../src/tags.js";

test("tags: block and item tags are read from the server's packet, each in its own registry", () => {
    const bot = { _client: new EventEmitter() };
    recordTags(bot);
    assert.throws(() => blockTag(bot, "leaves"), /not received/);
    bot._client.emit("tags", {
        tags: [
            { tagType: "minecraft:item", tags: [{ tagName: "minecraft:leaves", entries: [999] }] },
            { tagType: "minecraft:block", tags: [{ tagName: "minecraft:leaves", entries: [88, 89] }] },
        ],
    });
    assert.deepEqual([...blockTag(bot, "leaves")], [88, 89]);
    assert.equal(inBlockTag(bot, "leaves", { type: 88 }), true);
    assert.equal(inBlockTag(bot, "leaves", { type: 1 }), false);
    assert.throws(() => blockTag(bot, "replaceable"), /minecraft:replaceable/);
    assert.deepEqual([...findItemTag(bot, "leaves")], [999]); // the item tag of the same name, apart
    assert.equal(findItemTag(bot, "planks"), null);
});

test("tags: a set of items is named with the game's group only if it is EXACTLY that group", () => {
    const ids = { oak_planks: 1, birch_planks: 2, spruce_planks: 3, acacia_planks: 4 };
    const bot = { _client: new EventEmitter(), registry: { itemsByName: Object.fromEntries(Object.entries(ids).map(([n, id]) => [n, { id }])) } };
    recordTags(bot);
    bot._client.emit("tags", {
        tags: [{
            tagType: "minecraft:item",
            tags: [
                { tagName: "minecraft:planks", entries: [1, 2, 3] },
                { tagName: "minecraft:wooden_things", entries: [1, 2, 3] }, // same set, longer name
                { tagName: "minecraft:light_planks", entries: [2, 3] },
            ],
        }],
    });
    assert.equal(itemGroupOf(bot, ["spruce_planks", "oak_planks", "birch_planks"]), "#planks"); // order free
    assert.equal(itemGroupOf(bot, ["birch_planks", "spruce_planks"]), "#light_planks");
    assert.equal(itemGroupOf(bot, ["oak_planks", "birch_planks"]), null); // a subset of a group: no name
    // More variants than the group holds: not that group either
    assert.equal(itemGroupOf(bot, ["oak_planks", "birch_planks", "spruce_planks", "acacia_planks"]), null);
});
