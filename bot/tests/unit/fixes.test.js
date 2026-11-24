import assert from "node:assert";
import test from "node:test";
import AABB from "prismarine-physics/lib/aabb.js";
import { EventEmitter } from "node:events";
import { botOxygen, fixCraftSync, fixStateId, fixWallContact, resyncWindow, SYNC_QUIET_MS, WALL_GAP } from "../../src/game/fixes.js";

test("fixWallContact: a horizontal move stops 1 mm before a block face, a vertical one does not", () => {
    fixWallContact();
    const block = new AABB(0, 0, 0, 1, 1, 1); // the block from x=0 to x=1
    const player = new AABB(1.5, 0, 0.2, 2.1, 1.8, 0.8); // 0.5 block east of it
    // Walking west by 1 block would go through: stopped WALL_GAP before the face (x = 1)
    assert.ok(Math.abs(block.computeOffsetX(player, -1) - (-0.5 + WALL_GAP)) < 1e-12);
    // Same on z
    const north = new AABB(0.2, 0, 1.5, 0.8, 1.8, 2.1);
    assert.ok(Math.abs(block.computeOffsetZ(north, -1) - (-0.5 + WALL_GAP)) < 1e-12);
    // A move that does not reach the block is unchanged
    assert.strictEqual(block.computeOffsetX(player, -0.2), -0.2);
    // Falling onto the block: stops exactly on it (standing on the ground is exact)
    const above = new AABB(0.2, 1.5, 0.2, 0.8, 3.3, 0.8);
    assert.strictEqual(block.computeOffsetY(above, -1), -0.5);
});

// A fake server: each resync request is answered by a full inventory packet one "tick" later (20 ms here).
// `stale`: an OLD full inventory packet is already on its way when the request is sent (arrives at once).
function craftBot({ stale = false } = {}) {
  const calls = [];
  const client = new EventEmitter();
  const bot = {
    _client: client,
    inventory: { id: 0 },
    view: "fresh",
    craft: async (recipe, count, table) => calls.push(`craft ${count}${table ? " table" : ""}`),
    _syncWindow: async (window) => {
      calls.push(`sync ${window.id}`);
      if (stale) setImmediate(() => client.emit("window_items", { windowId: 0, items: [], label: "old" }));
      setTimeout(() => {
        bot.view = "server"; // the real answer
        client.emit("window_items", { windowId: 0, items: [], label: "answer" });
      }, 20);
    },
  };
  fixCraftSync(bot);
  return { bot, calls };
}

test("fixCraftSync: in the 2x2 grid, one craft at a time and a resync before and after each; a table: before and after", async () => {
  const { bot, calls } = craftBot();
  await bot.craft({}, 3, null);
  assert.deepStrictEqual(calls, ["sync 0", "craft 1", "sync 0", "craft 1", "sync 0", "craft 1", "sync 0"]);
  calls.length = 0;
  await bot.craft({}, 2, { position: {} });
  assert.deepStrictEqual(calls, ["sync 0", "craft 2 table", "sync 0"]);
});

test("resyncWindow waits for the server to be done, not for an old answer already on its way", async () => {
  const { bot } = craftBot({ stale: true });
  const start = Date.now();
  assert.strictEqual(await resyncWindow(bot, bot.inventory), true);
  assert.strictEqual(bot.view, "server"); // the real answer had arrived (the old one alone was not enough)
  assert.ok(Date.now() - start >= 20 + SYNC_QUIET_MS - 5);
  // Nothing is left listening
  assert.strictEqual(bot._client.listenerCount("window_items"), 0);
});

test("resyncWindow gives up after its cap when the server never answers", async () => {
  const bot = { _client: new EventEmitter(), inventory: { id: 0 }, _syncWindow: async () => {} };
  // (a shorter wait would need a parameter: the cap is 2 s, checked once)
  const start = Date.now();
  assert.strictEqual(await resyncWindow(bot, bot.inventory), false);
  assert.ok(Date.now() - start >= 1900);
});

test("fixStateId: each window's clicks carry that window's latest state id; -1 and other packets are untouched", () => {
  const sent = [];
  const client = Object.assign(new EventEmitter(), { write: (name, packet) => sent.push([name, packet]) });
  fixStateId({ _client: client });
  client.emit("window_items", { windowId: 0, stateId: 5 }); // the inventory
  client.emit("set_slot", { windowId: 1, stateId: 12 }); // a crafting table
  client.emit("set_slot", { windowId: 1, stateId: 13 }); // its latest
  // Mineflayer keeps ONE counter for every window: it would send 5 for the table
  client.write("window_click", { windowId: 1, stateId: 5, slot: 3 });
  client.write("window_click", { windowId: 0, stateId: 13, slot: 9 });
  client.write("window_click", { windowId: 0, stateId: -1, slot: -999 }); // "send me everything": on purpose
  client.write("window_click", { windowId: 2, stateId: 7, slot: 1 }); // a window never heard of: unchanged
  client.write("block_dig", { stateId: 99 }); // not a click
  assert.deepStrictEqual(
    sent.map(([name, p]) => [name, p.windowId, p.stateId]),
    [
      ["window_click", 1, 13],
      ["window_click", 0, 5],
      ["window_click", 0, -1],
      ["window_click", 2, 7],
      ["block_dig", undefined, 99],
    ],
  );
});

test("botOxygen: the bot's own air supply, not the last entity's", () => {
  // Mineflayer's bot.oxygenLevel follows ANY entity's air (here an axolotl's 6000 ticks -> 400)
  const bot = { oxygenLevel: 400, entity: { metadata: { 0: 0, 1: 150 } } };
  assert.strictEqual(botOxygen(bot), 10); // 150 ticks of air = half
  assert.strictEqual(botOxygen({ entity: { metadata: { 1: 300 } } }), 20);
  assert.strictEqual(botOxygen({ entity: { metadata: {} } }), null); // not sent yet
  assert.strictEqual(botOxygen({}), null);
});
