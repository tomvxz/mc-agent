import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import execute, { inventoryChange } from "../../src/execute.js";
import { observe, trackDeaths } from "../../src/state.js";
import { fakeBot } from "./fakeBot.js";

// Temporary journal: fake lines are never written to data/
const file = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-")),
  "transitions.jsonl",
);
process.env.TRANSITIONS_FILE = file;

const lines = () =>
  fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const last = () => lines().at(-1);

test("an unknown name fails AND is logged", async () => {
  const r = await execute(fakeBot(), "fly", {}, "unit");
  assert.deepStrictEqual([r.success, r.reason], [false, "unknown_skill"]);
  const d = last();
  assert.strictEqual(d.reason, "unknown_skill");
  assert.strictEqual(d.skill.name, "fly");
  assert.deepStrictEqual(d.state, d.next_state);
  assert.strictEqual(d.trace, null);
});

test('a name inherited from JavaScript ("constructor") is not a skill', async () => {
  const r = await execute(fakeBot(), "constructor", {}, "unit");
  assert.strictEqual(r.reason, "unknown_skill");
});

test("if observe throws (bot disconnected), the transition is still written with state null", async () => {
  const bot = fakeBot();
  bot.entity = undefined;
  await execute(bot, "mine", { block: "no_such_block" }, "unit");
  const d = last();
  assert.strictEqual(d.state, null);
  assert.strictEqual(d.reason, "unknown_block");
});

test("v6 line: minimal identity, times, args_resolved, result", async () => {
  await execute(fakeBot(), "find", { target: "oak_log" }, "unit", {
    episode_id: "ep-1",
    turn: 0,
  });
  const d = last();
  assert.strictEqual(d.schema_version, 6);
  assert.deepStrictEqual([d.source, d.episode_id, d.turn], ["unit", "ep-1", 0]);
  assert.strictEqual(typeof d.seq, "number");
  // Run-level facts are not repeated on every line (they are in runs.jsonl)
  for (const field of [
    "code_version",
    "catalogue_version",
    "skill_version",
    "world_id",
    "bot",
    "tick_rate",
    "scenario",
    "step",
    "id",
    "prev_id",
  ]) {
    assert.ok(!(field in d), `${field} should not be on the line`);
  }
  assert.deepStrictEqual([d.tick_start, d.tick_end], [5000, 5000]);
  assert.ok(Date.parse(d.wall_end) >= Date.parse(d.wall_start));
  assert.deepStrictEqual(d.skill.args_resolved, {
    target: "oak_log",
    count: 5,
    max_distance: 64,
  }); // defaults applied
  assert.deepStrictEqual(d.details, { target: "oak_log", max_distance: 64 }); // details of not_found
  // Removed in v6 (only useful to the future world model)
  for (const field of [
    "context",
    "continuous",
    "discontinuities",
    "interventions",
    "interventions_before",
    "trace_before",
  ]) {
    assert.ok(!(field in d), `${field} should not be on the line`);
  }
  assert.deepStrictEqual([d.timed_out, d.error], [false, null]);
});

test("state and next_state share one full format (observe), with an 11x11x11 grid", async () => {
  await execute(fakeBot({ inventory: { bread: 2 } }), "scan", {}, "unit");
  const d = last();
  for (const s of [d.state, d.next_state]) {
    assert.strictEqual(s.blocks.cells.length, 1331);
    assert.deepStrictEqual(s.blocks.palette, ["air"]);
    assert.deepStrictEqual(s.inventory, { bread: 2 });
    assert.strictEqual(s.difficulty, "easy");
  }
});

test("seq increases per bot", async () => {
  const bot = fakeBot();
  await execute(bot, "scan", {}, "unit");
  const first = last();
  await execute(bot, "scan", {}, "unit");
  assert.strictEqual(last().seq, first.seq + 1);
});

test("the trace records body + keys, actions, block changes, entities and events", async () => {
  const bot = fakeBot();
  bot.entity.id = 7;
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.velocity = { x: 0, y: 0, z: 0 };
  bot.entity.onGround = true;
  bot.controlState = { forward: true, jump: true };
  bot.entities = {
    3: {
      id: 3,
      name: "zombie",
      type: "hostile",
      position: bot.entity.position.offset(2, 0, 0),
    },
  };
  const air = {
    type: 0,
    name: "air",
    position: bot.entity.position.floored().offset(1, 0, 0),
  };
  const dirt = { type: 10, name: "dirt", position: air.position };
  bot.pathfinder.goto = async () => {
    bot.emit("physicsTick");
    bot._client.write("block_dig", {
      status: 0,
      location: { x: 1, y: 100, z: 0 },
      face: 1,
    });
    bot._client.write("position", { x: 0, y: 0, z: 0 }); // a movement packet: not an action
    bot.emit("blockUpdate", air, dirt);
    bot._client.emit("damage_event", {
      entityId: 7,
      sourceTypeId: 12,
      sourceCauseId: 4,
    });
    bot.health = 14;
    bot.emit("health");
  };
  await execute(bot, "move_to", { x: 0.5, y: 100, z: 0.5 }, "unit");
  const t = last().trace;
  assert.strictEqual(t.body.fields.at(-1), "controls");
  assert.strictEqual(t.body.rows[0].at(-1), 0b10001); // forward (bit 0) + jump (bit 4)
  assert.deepStrictEqual(
    t.actions.map((a) => a.packet),
    ["block_dig"],
  );
  assert.deepStrictEqual(t.actions[0].location, [1, 100, 0]);
  assert.deepStrictEqual(t.blocks.rows[0].slice(1), [1, 100, 0, "air", "dirt"]);
  assert.strictEqual(t.entities.rows[0][2], "zombie");
  assert.deepStrictEqual(
    t.events.map((e) => e.type),
    ["damage", "health_loss"],
  );
  assert.strictEqual(t.events[0].source, "zombie");
  assert.strictEqual(t.events[1].amount, 6);
  assert.deepStrictEqual(t.truncated, []);
});

test('a small server correction is a "correction" event', async () => {
  const bot = fakeBot();
  bot.entity.velocity = { x: 0, y: 0, z: 0 };
  bot.pathfinder.goto = async () => {
    bot.emit("physicsTick"); // a body row at the current position
    bot.entity.position = bot.entity.position.offset(0.3, 0, 0); // the server nudges the bot
    bot.emit("forcedMove");
  };
  await execute(bot, "move_to", { x: 0.5, y: 100, z: 0.5 }, "unit");
  const d = last();
  assert.deepStrictEqual(
    d.trace.events.map((e) => [e.type, e.distance]),
    [["correction", 0.3]],
  );
});

test("a teleport or a death during the skill are events of the trace", async () => {
  const bot = fakeBot();
  bot.pathfinder.goto = async () => {
    bot.emit("forcedMove");
    bot.emit("death");
  };
  await execute(bot, "move_to", { x: 0.5, y: 100, z: 0.5 }, "unit");
  const d = last();
  assert.deepStrictEqual(
    d.trace.events.map((e) => e.type),
    ["teleport", "death"],
  );
});

test("lines without meta do not carry episode fields", async () => {
  await execute(fakeBot(), "scan", {}, "unit");
  const d = last();
  for (const field of ["episode_id", "turn"]) assert.ok(!(field in d), field);
});

test("the brain gets a short summary of the trace: damage taken, death", async () => {
  const bot = fakeBot();
  bot.pathfinder.goto = async () => {
    bot.health = 12;
    bot.emit("health");
    bot.emit("death");
  };
  const r = await execute(bot, "move_to", { x: 0.5, y: 100, z: 0.5 }, "unit");
  assert.deepStrictEqual(r.body_events, { damage_taken: 8, died: true });
  assert.ok(!("error" in r)); // the error details stay in the journal
});

test("the state counts deaths (trackDeaths)", async () => {
  const bot = fakeBot();
  trackDeaths(bot);
  bot.emit("death");
  assert.strictEqual(observe(bot).deaths, 1);
});

test("a timeout tells the brain what changed in the inventory (computed, not logged)", () => {
  const before = { inventory: { oak_log: 4, dirt: 2 } };
  const after = { inventory: { oak_log: 12, bamboo: 69 } };
  assert.deepStrictEqual(inventoryChange(before, after), { oak_log: 8, dirt: -2, bamboo: 69 });
  assert.deepStrictEqual(inventoryChange(null, after), { oak_log: 12, bamboo: 69 });
});
