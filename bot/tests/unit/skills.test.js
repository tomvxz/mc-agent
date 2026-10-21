// The failure cases of each skill that are decided BEFORE acting in the game.
// Cases that need the real game live in tests/game/.
import assert from "node:assert";
import test from "node:test";
import prismarineRecipe from "prismarine-recipe";
import skills from "../../src/skills/index.js";
import { landingSpot } from "../../src/skills/utils.js";
import { fakeBot, Point, MC_VERSION } from "./fakeBot.js";

// Check success + reason
async function expectResult(promise, success, reason) {
  const r = await promise;
  assert.deepStrictEqual(
    [r.success, r.reason],
    [success, reason],
    JSON.stringify(r),
  );
  assert.ok(
    r.details && typeof r.details === "object",
    "details must be an object",
  );
  return r;
}

test("the skills of batch 1 (+ pick_up and collect_block, split out of break_block, + recipe, + low level)", () => {
  assert.deepStrictEqual(Object.keys(skills).sort(), [
    "break_block",
    "collect_block",
    "craft",
    "craftable",
    "eat",
    "explore",
    "find",
    "look",
    "mine",
    "move_to",
    "pick_up",
    "place_block",
    "press",
    "recipe",
    "scan",
    "walk",
  ]);
});

test("move_to: invalid coordinates", async () => {
  await expectResult(skills.move_to(fakeBot(), {}), false, "invalid_args");
  await expectResult(
    skills.move_to(fakeBot(), { x: "1", y: 2, z: 3 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.move_to(fakeBot(), { x: 1, y: 2, z: 3, range: -1 }),
    false,
    "invalid_args",
  );
});

test("move_to: a target inside a solid block fails at once with an explicit small range", async () => {
  const bot = fakeBot({ blocks: { "10,100,0": "oak_log" } });
  let walked = false;
  bot.pathfinder.goto = async () => {
    walked = true;
  };
  const r = await expectResult(
    skills.move_to(bot, { x: 10, y: 100, z: 0, range: 1 }),
    false,
    "target_blocked",
  );
  assert.strictEqual(r.details.block, "oak_log");
  assert.strictEqual(walked, false);
  // With the default range (2) the request is valid: go next to it
  bot.entity.position = bot.entity.position.clone().set(8.5, 100, 0.5);
  await expectResult(skills.move_to(bot, { x: 10, y: 100, z: 0 }), true, "ok");
});

test("move_to: pathfinder errors are translated into reasons", async () => {
  const cases = {
    NoPath: "no_path",
    Timeout: "path_timeout",
    GoalChanged: "interrupted",
    PathStopped: "interrupted",
  };
  for (const [name, reason] of Object.entries(cases)) {
    const bot = fakeBot();
    bot.pathfinder.goto = async () => {
      const e = new Error(name);
      e.name = name;
      throw e;
    };
    await expectResult(
      skills.move_to(bot, { x: 10, y: 100, z: 0 }),
      false,
      reason,
    );
  }
});

test('move_to: the pathfinder says "arrived" but the bot is far -> not_arrived', async () => {
  const r = await expectResult(
    skills.move_to(fakeBot(), { x: 50, y: 100, z: 0 }),
    false,
    "not_arrived",
  );
  assert.deepStrictEqual(
    [r.details.blocks_placed, r.details.blocks_broken],
    [0, 0],
  );
});

test("break_block: arguments, nothing to break, unbreakable, missing tool", async () => {
  await expectResult(
    skills.break_block(fakeBot(), { x: 1.5, y: 100, z: 0 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.break_block(fakeBot(), { x: 1, y: 100, z: 0 }),
    false,
    "nothing_to_break",
  );
  const water = fakeBot({ blocks: { "1,100,0": "water" } });
  await expectResult(
    skills.break_block(water, { x: 1, y: 100, z: 0 }),
    false,
    "nothing_to_break",
  );
  const barrier = fakeBot({ blocks: { "1,100,0": "barrier" } });
  await expectResult(
    skills.break_block(barrier, { x: 1, y: 100, z: 0 }),
    false,
    "unbreakable",
  );
  const stone = fakeBot({ blocks: { "1,100,0": "stone" } });
  const r = await expectResult(
    skills.break_block(stone, { x: 1, y: 100, z: 0 }),
    false,
    "no_tool",
  );
  assert.ok(r.details.tools.includes("wooden_pickaxe"));
});

test("place_block: arguments, inventory, occupied cell, no support", async () => {
  await expectResult(
    skills.place_block(fakeBot(), { item: "stone", x: 1.5, y: 100, z: 0 }),
    false,
    "invalid_args",
  );
  // The old argument name "block" is no longer accepted
  await expectResult(
    skills.place_block(fakeBot(), { block: "stone", x: 1, y: 100, z: 0 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.place_block(fakeBot(), {
      item: "no_such_block",
      x: 1,
      y: 100,
      z: 0,
    }),
    false,
    "unknown_block",
  );
  await expectResult(
    skills.place_block(fakeBot(), { item: "cobblestone", x: 1, y: 100, z: 0 }),
    false,
    "not_in_inventory",
  );
  const occupied = fakeBot({
    inventory: { cobblestone: 5 },
    blocks: { "1,100,0": "stone" },
  });
  await expectResult(
    skills.place_block(occupied, { item: "cobblestone", x: 1, y: 100, z: 0 }),
    false,
    "occupied",
  );
  // A flower is not replaceable in the game: occupied
  const flower = fakeBot({
    inventory: { cobblestone: 5 },
    blocks: { "1,100,0": "poppy" },
  });
  await expectResult(
    skills.place_block(flower, { item: "cobblestone", x: 1, y: 100, z: 0 }),
    false,
    "occupied",
  );
  // Grass is replaced by the game: not occupied (here, no support: the next check)
  const grass = fakeBot({
    inventory: { cobblestone: 5 },
    blocks: { "1,100,0": "short_grass" },
  });
  await expectResult(
    skills.place_block(grass, { item: "cobblestone", x: 1, y: 100, z: 0 }),
    false,
    "no_support",
  );
  const midAir = fakeBot({ inventory: { cobblestone: 5 } }); // only air around
  await expectResult(
    skills.place_block(midAir, { item: "cobblestone", x: 1, y: 100, z: 0 }),
    false,
    "no_support",
  );
});

test("craft: arguments, unknown item, no recipe, ingredients, table", async () => {
  await expectResult(
    skills.craft(fakeBot(), { item: "stick", count: 0 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.craft(fakeBot(), { item: "no_such_item" }),
    false,
    "unknown_item",
  );
  await expectResult(
    skills.craft(fakeBot(), { item: "dirt" }),
    false,
    "no_recipe",
  ); // empty recipesAll

  // The real recipes of the game (prismarine-recipe), filtered like Mineflayer does
  const { Recipe } = prismarineRecipe(MC_VERSION);
  const realRecipes = (id, meta, table) =>
    Recipe.find(id).filter((r) => !r.requiresTable || table);

  const noIngredients = fakeBot();
  noIngredients.recipesAll = realRecipes;
  await expectResult(
    skills.craft(noIngredients, { item: "stick" }),
    false,
    "missing_ingredients",
  );

  // Ingredients OK only with a table (3x3), but no table around
  const noTable = fakeBot({ inventory: { oak_planks: 3, stick: 2 } });
  noTable.recipesAll = realRecipes;
  noTable.recipesFor = (id, meta, n, table) =>
    table ? [{ result: { count: 1 } }] : [];
  await expectResult(
    skills.craft(noTable, { item: "wooden_pickaxe" }),
    false,
    "no_crafting_table",
  );
});

test("craft: a failure says what the recipe needs (like the recipe book), variants merged", async () => {
  const { Recipe } = prismarineRecipe(MC_VERSION);
  const bot = fakeBot();
  bot.recipesAll = (id, meta, table) =>
    Recipe.find(id).filter((r) => !r.requiresTable || table);
  let r = await skills.craft(bot, { item: "wooden_pickaxe" });
  assert.strictEqual(r.details.needs_table, true);
  // A list; the planks variants are ONE entry without a name (no "any_planks" pseudo-item)
  assert.deepStrictEqual(r.details.ingredients[0], { item: "stick", required: 2, owned: 0 });
  const planks = r.details.ingredients[1];
  assert.deepStrictEqual([planks.item, planks.required, planks.owned], [undefined, 3, 0]);
  assert.ok(planks.one_of.includes("oak_planks"));

  // With oak planks in the inventory, the oak recipe is the closest: named precisely
  const withOak = fakeBot({ inventory: { oak_planks: 3 } });
  withOak.recipesAll = bot.recipesAll;
  r = await skills.craft(withOak, { item: "wooden_pickaxe" });
  assert.deepStrictEqual(
    [...r.details.ingredients].sort((a, b) => a.item.localeCompare(b.item)),
    [
      { item: "oak_planks", required: 3, owned: 3 },
      { item: "stick", required: 2, owned: 0 }, // strictly one level: nothing about how to get it
    ],
  );

  // Recipes without the usual fields: the reason stays right, the extra details are just left out
  const odd = fakeBot();
  odd.recipesAll = () => [{}];
  r = await expectResult(
    skills.craft(odd, { item: "stick" }),
    false,
    "missing_ingredients",
  );
  assert.strictEqual(r.details.ingredients, undefined);
});

test("eat: unknown food, not hungry, nothing to eat", async () => {
  await expectResult(
    skills.eat(fakeBot({ food: 10 }), { food: "diamond" }),
    false,
    "unknown_item",
  );
  await expectResult(
    skills.eat(fakeBot({ food: 10 }), { food: 3 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.eat(fakeBot({ food: 20, inventory: { bread: 3 } })),
    false,
    "not_hungry",
  );
  await expectResult(
    skills.eat(fakeBot({ food: 10, inventory: { dirt: 3 } })),
    false,
    "no_food",
  );
  // Rotten flesh is never picked automatically
  await expectResult(
    skills.eat(fakeBot({ food: 10, inventory: { rotten_flesh: 3 } })),
    false,
    "no_food",
  );
});

test("find: arguments, unknown target, nothing found", async () => {
  await expectResult(skills.find(fakeBot(), {}), false, "invalid_args");
  await expectResult(
    skills.find(fakeBot(), { target: "oak_log", max_distance: 500 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.find(fakeBot(), { target: "no_such_thing" }),
    false,
    "unknown_target",
  );
  await expectResult(
    skills.find(fakeBot(), { target: "oak_log" }),
    false,
    "not_found",
  );
});

test("find: blocks sorted nearest first, limited to count", async () => {
  const bot = fakeBot({
    blocks: {
      "20,100,0": "oak_log",
      "3,100,0": "oak_log",
      "10,100,0": "oak_log",
      "5,100,0": "stone",
    },
  });
  const r = await expectResult(
    skills.find(bot, { target: "oak_log", count: 2 }),
    true,
    "ok",
  );
  assert.deepStrictEqual(
    r.details.matches.map((m) => m.x),
    [3, 10],
  );
});

test('find: "hostile" finds a slime (type mob) but not a pig', async () => {
  const entities = {
    1: { type: "animal", name: "pig", position: new Point(2, 100, 0) },
    2: { type: "mob", name: "slime", position: new Point(6, 100, 0) },
  };
  const r = await expectResult(
    skills.find(fakeBot({ entities }), { target: "hostile" }),
    true,
    "ok",
  );
  assert.deepStrictEqual(
    r.details.matches.map((m) => m.name),
    ["slime"],
  );
  const pig = await expectResult(
    skills.find(fakeBot({ entities }), { target: "pig" }),
    true,
    "ok",
  );
  assert.strictEqual(pig.details.matches[0].distance, 1.6); // from (0.5, 0.5) to (2, 0)
});

test("scan: arguments and shape of the result", async () => {
  await expectResult(
    skills.scan(fakeBot(), { radius: 100 }),
    false,
    "invalid_args",
  );
  const bot = fakeBot({
    blocks: {
      "3,100,0": "oak_log",
      "4,100,0": "oak_log",
      "2,99,0": "iron_ore",
      "1,99,0": "dirt",
    },
    entities: {
      1: { type: "hostile", name: "zombie", position: new Point(5, 100, 4) }, // not behind the logs
    },
  });
  const r = await expectResult(skills.scan(bot), true, "ok");
  assert.deepStrictEqual(r.details.blocks.oak_log, {
    count: 2,
    nearest: [3, 100, 0],
  });
  assert.strictEqual(r.details.blocks.iron_ore.count, 1);
  assert.strictEqual(r.details.blocks.dirt.count, 1); // every kind of block in sight: no list
  assert.strictEqual(r.details.entities.zombie.count, 1);
});

test("explore: invalid direction and distance", async () => {
  await expectResult(
    skills.explore(fakeBot(), { direction: "up" }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.explore(fakeBot(), { direction: "north", distance: 0 }),
    false,
    "invalid_args",
  );
});

test("mine: unknown block, invalid count, block absent", async () => {
  await expectResult(
    skills.mine(fakeBot(), { block: "no_such_block" }),
    false,
    "unknown_block",
  );
  for (const count of [0, -1, "2", 1.5, null]) {
    await expectResult(
      skills.mine(fakeBot(), { block: "oak_log", count }),
      false,
      "invalid_args",
    );
  }
  await expectResult(
    skills.mine(fakeBot(), { block: "oak_log" }),
    false,
    "block_not_found",
  );
});

// A log at 2,100,0 hidden by `hider` at 1,101,0 (the fake line of sight hits it while it is there)
function hiddenLog(hider) {
  const blocks = { "2,100,0": "oak_log", "1,101,0": hider };
  const bot = fakeBot({ blocks });
  // The ray must be long enough to reach the log (about 2 blocks away), otherwise it hits nothing
  bot.world = {
    raycast: (from, dir, maxDistance) => {
      if (maxDistance < 2) return null;
      return blocks["1,101,0"]
        ? bot.blockAt(new Point(1, 101, 0))
        : bot.blockAt(new Point(2, 100, 0));
    },
  };
  bot.pathfinder.movements = { safeToBreak: () => true };
  const calls = [];
  bot.dig = async (b) => {
    calls.push(`dig ${b.name}`);
    delete blocks[`${b.position.x},${b.position.y},${b.position.z}`];
  };
  bot.pathfinder.goto = async (goal) => {
    calls.push(`goto ${goal.constructor.name}`);
  };
  return { bot, calls };
}

test("break_block: no viewpoint and leaves in the way -> the leaves are broken (quick to break)", async () => {
  const { bot, calls } = hiddenLog("oak_leaves");
  const r = await expectResult(
    skills.break_block(bot, { x: 2, y: 100, z: 0 }),
    true,
    "ok",
  );
  assert.strictEqual(r.details.cleared, 1);
  // A viewpoint is asked first; there is none here, so the bot walks next to it and clears the leaves
  assert.deepStrictEqual(calls, [
    "goto GoalLookAtBlock",
    "goto GoalNear",
    "dig oak_leaves",
    "dig oak_log",
  ]);
});

test("break_block: a block hidden by stone -> only viewpoints, the stone is never broken", async () => {
  const { bot, calls } = hiddenLog("stone");
  const r = await expectResult(
    skills.break_block(bot, { x: 2, y: 100, z: 0 }),
    false,
    "no_path",
  );
  assert.strictEqual(r.details.cleared, 0);
  assert.ok(
    calls.every((c) => c.startsWith("goto")),
    calls.join(", "),
  ); // only moved, never dug the stone
});

test("mine: stone without a pickaxe -> no_tool (bubbles up from break_block)", async () => {
  const bot = fakeBot({ blocks: { "3,100,0": "stone" } });
  await expectResult(skills.mine(bot, { block: "stone" }), false, "no_tool");
});

// A stone at 2,100,0 in plain view; dig() removes it
function visibleStone() {
  const blocks = { "2,100,0": "stone" };
  const bot = fakeBot({ blocks });
  bot.world = { raycast: () => bot.blockAt(new Point(2, 100, 0)) };
  const calls = [];
  bot.dig = async (b) => {
    calls.push(`dig ${b.name}`);
    delete blocks[`${b.position.x},${b.position.y},${b.position.z}`];
  };
  return { bot, calls };
}

test("break_block: require_tool false breaks without the tool and says no_drop; a bad value is refused", async () => {
  const { bot, calls } = visibleStone();
  await expectResult(
    skills.break_block(bot, { x: 2, y: 100, z: 0, require_tool: "no" }),
    false,
    "invalid_args",
  );
  await expectResult(skills.break_block(bot, { x: 2, y: 100, z: 0 }), false, "no_tool");
  const r = await expectResult(
    skills.break_block(bot, { x: 2, y: 100, z: 0, require_tool: false }),
    true,
    "ok",
  );
  assert.strictEqual(r.details.no_drop, true);
  assert.deepStrictEqual(calls, ["dig stone"]);
});

test("budgets: break_block counts the game's digging time, mine the number of blocks", () => {
  const { bot } = visibleStone();
  const stone = bot.blockAt(new Point(2, 100, 0));
  bot.blockAt = () => ({ ...stone, digTime: () => 7500 }); // stone by hand: 7.5 s in the game
  const seconds = skills.break_block.budget(bot, { x: 2, y: 100, z: 0 });
  assert.ok(seconds > 7.5 && seconds < 12, `${seconds}`);
  assert.ok(skills.mine.budget(bot, { block: "stone", count: 10 }) > skills.mine.budget(bot, { block: "stone", count: 2 }));
  // The walk to the nearest block counts: a log 58 blocks away takes longer than one next to the bot
  const far = fakeBot();
  far.findBlock = () => ({ position: new Point(58, 100, 0) });
  const near = fakeBot();
  near.findBlock = () => ({ position: new Point(2, 100, 0) });
  assert.ok(skills.mine.budget(far, { block: "oak_log" }) - skills.mine.budget(near, { block: "oak_log" }) > 15);
});

test("find and mine: a game group of blocks ('#logs'), an unknown group", async () => {
  const bot = fakeBot({
    blocks: { "10,100,0": "birch_log", "3,100,0": "oak_log", "5,100,0": "stone" },
  });
  const r = await expectResult(skills.find(bot, { target: "#logs" }), true, "ok");
  assert.deepStrictEqual(
    r.details.matches.map((m) => [m.block, m.x]),
    [["oak_log", 3], ["birch_log", 10]],
  );
  await expectResult(skills.find(bot, { target: "#no_such_group" }), false, "unknown_target");
  await expectResult(skills.mine(fakeBot(), { block: "#no_such_group" }), false, "unknown_block");
  await expectResult(skills.mine(fakeBot(), { block: "#logs" }), false, "block_not_found");
});

// An item lying on the ground; walking onto it (pathfinder.goto) picks it up into the inventory
function itemOnGround(bot, id, name, count, at) {
  const entity = {
    id,
    name: "item",
    position: at,
    getDroppedItem: () => ({ name, count }),
  };
  bot.entities[id] = entity;
  return entity;
}
function pickUpWhenWalking(bot) {
  bot.pathfinder.goto = async (goal) => {
    for (const e of Object.values(bot.entities)) {
      // GoalNear keeps whole-block coordinates
      if (
        e.name !== "item" ||
        Math.floor(e.position.x) !== goal.x ||
        Math.floor(e.position.z) !== goal.z
      )
        continue;
      const { name, count } = e.getDroppedItem();
      bot.inventory
        .items()
        .push({ name, count, type: bot.registry.itemsByName[name].id });
      delete bot.entities[e.id];
    }
  };
}

test("pick_up: arguments, unknown item, nothing on the ground", async () => {
  await expectResult(
    skills.pick_up(fakeBot(), { item: 3 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.pick_up(fakeBot(), { item: "no_such_item" }),
    false,
    "unknown_item",
  );
  await expectResult(
    skills.pick_up(fakeBot(), { max_distance: 100 }),
    false,
    "invalid_args",
  );
  await expectResult(
    skills.pick_up(fakeBot(), {}),
    false,
    "nothing_to_pick_up",
  );
});

test("pick_up: walks onto the items, only those of the requested type", async () => {
  const bot = fakeBot();
  itemOnGround(bot, 1, "oak_log", 2, new Point(3.5, 100, 0.5));
  itemOnGround(bot, 2, "dirt", 1, new Point(-2.5, 100, 0.5));
  pickUpWhenWalking(bot);
  const r = await expectResult(
    skills.pick_up(bot, { item: "oak_log" }),
    true,
    "ok",
  );
  assert.deepStrictEqual(r.details.collected, { oak_log: 2 });
  assert.ok(bot.entities[2], "the dirt was not asked for: still on the ground");
});

test("pick_up: an item out of max_distance is not seen", async () => {
  const bot = fakeBot();
  itemOnGround(bot, 1, "oak_log", 1, new Point(20.5, 100, 0.5));
  await expectResult(
    skills.pick_up(bot, { max_distance: 8 }),
    false,
    "nothing_to_pick_up",
  );
});

test("collect_block = break_block (which no longer picks up) + pick_up", async () => {
  const blocks = { "2,100,0": "oak_log" };
  const bot = fakeBot({ blocks });
  bot.world = { raycast: () => bot.blockAt(new Point(2, 100, 0)) }; // the log is visible
  pickUpWhenWalking(bot);
  // Digging removes the block and drops its item next to it
  bot.dig = async () => {
    delete blocks["2,100,0"];
    itemOnGround(bot, 9, "oak_log", 1, new Point(2.5, 100, 0.5));
  };
  const broken = await expectResult(
    skills.break_block(bot, { x: 2, y: 100, z: 0 }),
    true,
    "ok",
  );
  assert.deepStrictEqual(
    broken.details.drops.map((d) => [d.name, d.count]),
    [["oak_log", 1]],
  );
  assert.deepStrictEqual(broken.details.collected, {}); // break_block does not pick up
  assert.ok(bot.entities[9], "the item is still on the ground");

  blocks["2,100,0"] = "oak_log";
  delete bot.entities[9];
  const r = await expectResult(
    skills.collect_block(bot, { x: 2, y: 100, z: 0 }),
    true,
    "ok",
  );
  assert.deepStrictEqual(r.details.collected, { oak_log: 1 });
});

test("collect_block: the item fell out of reach -> not_collected", async () => {
  const blocks = { "2,100,0": "oak_log" };
  const bot = fakeBot({ blocks });
  bot.world = { raycast: () => bot.blockAt(new Point(2, 100, 0)) };
  bot.pathfinder.goto = async () => {
    const e = new Error("No path to the goal!");
    e.name = "NoPath";
    throw e;
  };
  bot.dig = async () => {
    delete blocks["2,100,0"];
    itemOnGround(bot, 9, "oak_log", 1, new Point(2.5, 100, 0.5));
  };
  const r = await expectResult(
    skills.collect_block(bot, { x: 2, y: 100, z: 0 }),
    false,
    "not_collected",
  );
  assert.strictEqual(r.details.drops.length, 1);
});

const xyz = (p) => [p.x, p.y, p.z];

test("landingSpot: a falling drop is aimed at where it will lie (on leaves too)", () => {
  const bot = fakeBot({ blocks: { "3,96,4": "stone", "6,98,6": "oak_leaves" } });
  // Fresh drop where a log was, 3 blocks above the ground: it lands on the stone
  assert.deepStrictEqual(xyz(landingSpot(bot, new Point(3.4, 99.2, 4.6))), [3.4, 97, 4.6]);
  // Leaves stop a falling item
  assert.deepStrictEqual(xyz(landingSpot(bot, new Point(6.5, 101, 6.5))), [6.5, 99, 6.5]);
  // Nothing below within 16 blocks: aim where it is
  assert.deepStrictEqual(xyz(landingSpot(bot, new Point(20.5, 100, 20.5))), [20.5, 100, 20.5]);
});

test("recipe: one level only, both ways; variants named with the game's group", async () => {
  const { Recipe } = prismarineRecipe(MC_VERSION);
  const bot = fakeBot();
  bot.recipesAll = (id, meta, table) => Recipe.find(id).filter((r) => !r.requiresTable || table);
  const r = await expectResult(skills.recipe(bot, { item: "crafting_table" }), true, "ok");
  assert.deepStrictEqual([r.details.needs_table, r.details.makes], [false, 1]);
  assert.strictEqual(r.details.ingredients.length, 1);
  const [planks] = r.details.ingredients;
  assert.deepStrictEqual(Object.keys(planks), ["group", "one_of", "required", "owned"]); // nothing about logs
  assert.deepStrictEqual([planks.group, planks.required, planks.owned], ["#planks", 4, 0]);
  assert.ok(planks.one_of.includes("birch_planks") && planks.one_of.includes("oak_planks"));
  // The next level, when asked: one item, or the whole group
  const next = await expectResult(skills.recipe(bot, { item: "birch_planks" }), true, "ok");
  assert.deepStrictEqual(next.details.ingredients, [{ item: "birch_log", required: 1, owned: 0 }]);
  assert.strictEqual(next.details.makes, 4);
  const group = await expectResult(skills.recipe(bot, { item: "#planks" }), true, "ok");
  const birch = group.details.recipes.find((x) => x.item === "birch_planks");
  assert.deepStrictEqual(birch.ingredients, [{ item: "birch_log", required: 1, owned: 0 }]);
  // The other way: what is crafted directly from it (one level: planks, not the table)
  const uses = await expectResult(skills.recipe(bot, { uses: "birch_log" }), true, "ok");
  const made = uses.details.used_in.map((u) => u.item);
  assert.ok(made.includes("birch_planks") && !made.includes("crafting_table"), JSON.stringify(made));
  const fromLogs = await expectResult(skills.recipe(bot, { uses: "#logs" }), true, "ok");
  assert.ok(fromLogs.details.used_in.some((u) => u.item === "spruce_planks"));
  // A log is gathered, not crafted
  await expectResult(skills.recipe(bot, { item: "birch_log" }), false, "no_recipe");
  // The failures decided before anything else
  await expectResult(skills.recipe(bot, {}), false, "invalid_args");
  await expectResult(skills.recipe(bot, { item: "oak_log", uses: "oak_log" }), false, "invalid_args");
  await expectResult(skills.recipe(bot, { item: "no_such_item" }), false, "unknown_item");
  await expectResult(skills.recipe(bot, { item: "#no_such_group" }), false, "unknown_item");
  await expectResult(skills.recipe(bot, { item: "any_planks" }), false, "unknown_item"); // not an item
});

test("craftable: what the inventory allows now (like the recipe book's filter), and with a table", async () => {
  const bot = fakeBot({ inventory: { birch_log: 2 } });
  const birch = bot.registry.itemsByName.birch_planks.id;
  const pickaxe = bot.registry.itemsByName.wooden_pickaxe.id;
  bot.recipesFor = (id, meta, n, table) =>
    id === birch ? [{ result: { count: 4 } }] : id === pickaxe && table ? [{ result: { count: 1 } }] : [];
  const r = await expectResult(skills.craftable(bot), true, "ok");
  assert.deepStrictEqual(r.details.now, [{ item: "birch_planks", makes: 4 }]);
  assert.deepStrictEqual(r.details.with_table, [{ item: "wooden_pickaxe", makes: 1 }]);
  assert.strictEqual(r.details.table_near, false);
  await expectResult(skills.craftable(fakeBot()), false, "nothing_craftable");
});

// A floor of stone at y=99 from x=-2 to 12 (z=0), the bot at (0.5, 100, 0.5)
const floor = (extra = {}) => {
  const blocks = { ...extra };
  for (let x = -2; x <= 12; x++) blocks[`${x},99,0`] ??= "stone";
  return blocks;
};

test("walk: arguments; a wall, a drop and water ahead are refused before moving", async () => {
  await expectResult(skills.walk(fakeBot(), { yaw: "east" }), false, "invalid_args");
  await expectResult(skills.walk(fakeBot(), { yaw: -Math.PI / 2, distance: 20 }), false, "invalid_args");
  const wall = await expectResult(
    skills.walk(fakeBot({ blocks: floor({ "1,100,0": "stone", "1,101,0": "stone" }) }), { yaw: -Math.PI / 2 }),
    false,
    "blocked",
  );
  assert.strictEqual(wall.details.obstacle.block, "stone");
  const drop = await expectResult(skills.walk(fakeBot(), { yaw: -Math.PI / 2 }), false, "danger_ahead");
  assert.strictEqual(drop.details.danger, "drop");
  const water = await expectResult(
    skills.walk(fakeBot({ blocks: floor({ "1,99,0": "water" }) }), { yaw: -Math.PI / 2 }),
    false,
    "danger_ahead",
  );
  assert.strictEqual(water.details.danger, "water");
});

test("walk: faces the direction and holds forward, jumps a one-block step, releases the keys", async () => {
  const bot = fakeBot({ blocks: floor({ "1,100,0": "stone" }) }); // a step, room above it
  const held = [];
  bot.setControlState = (key, value) => {
    if (value) held.push(key);
    if (value && key === "forward") bot.entity.position.x += 0.5; // the fake walks half a block per step
    bot.controlState[key] = value;
  };
  await expectResult(skills.walk(bot, { yaw: -Math.PI / 2, distance: 1 }), true, "ok");
  assert.strictEqual(bot.entity.yaw, -Math.PI / 2); // it faces where it walks (east)
  assert.ok(held.includes("jump"));
  assert.deepStrictEqual([bot.controlState.forward, bot.controlState.jump], [false, false]);
});

test("look and press: arguments; press holds the keys then releases them, without any check (raw)", async () => {
  await expectResult(skills.look(fakeBot(), { yaw: "north" }), false, "invalid_args");
  await expectResult(skills.look(fakeBot(), { yaw: 0, pitch: 3 }), false, "invalid_args");
  await expectResult(skills.press(fakeBot(), { keys: [] }), false, "invalid_args");
  await expectResult(skills.press(fakeBot(), { keys: ["fly"] }), false, "invalid_args");
  await expectResult(skills.press(fakeBot(), { keys: ["jump"], ticks: 100 }), false, "invalid_args");

  const bot = fakeBot(); // only air around: walk would refuse (drop), press does not check
  await expectResult(skills.look(bot, { yaw: -Math.PI / 2 }), true, "ok");
  const held = [];
  bot.setControlState = (key, value) => {
    if (value) held.push(key);
    bot.controlState[key] = value;
  };
  await expectResult(skills.press(bot, { keys: ["forward", "sprint"], ticks: 2 }), true, "ok");
  assert.deepStrictEqual(held, ["forward", "sprint"]);
  assert.deepStrictEqual([bot.controlState.forward, bot.controlState.sprint], [false, false]);
});
