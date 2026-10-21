import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { blockTag, inBlockTag, recordTags } from "../../src/tags.js";

test("tags: block tags are read from the server's packet, other registries ignored", () => {
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
});
