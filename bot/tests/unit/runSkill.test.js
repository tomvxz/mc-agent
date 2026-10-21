import assert from "node:assert";
import test from "node:test";
import runSkill from "../../src/runSkill.js";
import { sleep, waitUntil } from "../../src/skills/utils.js";
import { fakeBot } from "./fakeBot.js";

test("a successful skill keeps its result and gets a duration", async () => {
  const r = await runSkill(
    fakeBot(),
    async () => ({ success: true, reason: "ok", details: {} }),
    {},
  );
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.reason, "ok");
  assert.strictEqual(typeof r.duration, "number");
});

test("a skill that takes too long returns timeout and stops the pathfinder", async () => {
  const bot = fakeBot();
  let stopped = false;
  bot.pathfinder.setGoal = (goal) => {
    if (goal === null) stopped = true;
  };
  const r = await runSkill(bot, () => new Promise(() => {}), {}, { hardCapS: 0.1 });
  assert.strictEqual(r.reason, "timeout");
  assert.strictEqual(stopped, true);
});

test('an exception becomes an "exception" failure', async () => {
  const r = await runSkill(
    fakeBot(),
    async () => {
      throw new Error("boom");
    },
    {},
  );
  assert.deepStrictEqual(
    [r.success, r.reason, r.details.error],
    [false, "exception", "boom"],
  );
  assert.deepStrictEqual([r.error.type, r.error.message], ["Error", "boom"]);
  assert.ok(r.error.stack.includes("runSkill.test.js"));
});

test('a malformed result becomes "bad_result"', async () => {
  const r = await runSkill(fakeBot(), async () => "not an object", {});
  assert.deepStrictEqual([r.success, r.reason], [false, "bad_result"]);
});

test("a timed-out skill is really stopped: its later actions are refused", async () => {
  const bot = fakeBot();
  const done = [];
  bot.pathfinder.goto = async () => {
    done.push("goto");
  };
  const slow = async (b) => {
    await new Promise((r) => setTimeout(r, 150)); // still busy when the time limit hits
    await b.pathfinder.goto(); // must be refused: the skill was stopped
    done.push("after goto");
  };
  const r = await runSkill(bot, slow, {}, { hardCapS: 0.05 });
  assert.strictEqual(r.reason, "timeout");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepStrictEqual(done, []); // the ghost skill did nothing

  // The next skill is not affected
  const r2 = await runSkill(
    bot,
    async (b) => {
      await b.pathfinder.goto();
      return { success: true, reason: "ok", details: {} };
    },
    {},
  );
  assert.strictEqual(r2.success, true);
  assert.deepStrictEqual(done, ["goto"]);
});

test("actions outside any skill (pathfinder loop, test setup) are never refused", async () => {
  const bot = fakeBot();
  let calls = 0;
  bot.pathfinder.goto = async () => {
    calls++;
  };
  await runSkill(bot, () => new Promise(() => {}), {}, { hardCapS: 0.02 }); // a skill that times out
  await bot.pathfinder.goto(); // called from outside a skill: allowed
  assert.strictEqual(calls, 1);
});

test("at the time limit the keys are released (the bot does not keep walking)", async () => {
  const bot = fakeBot();
  const holdForward = async (b) => {
    b.setControlState("forward", true);
    await new Promise(() => {});
  };
  const r = await runSkill(bot, holdForward, {}, { hardCapS: 0.03 });
  assert.strictEqual(r.reason, "timeout");
  assert.deepStrictEqual(bot.controlState, {});
});

test("a stopped skill ends during its next wait (sleep / waitUntil), not only at its next action", async () => {
  for (const wait of [() => waitUntil(() => false, 5000), () => sleep(5000)]) {
    let endedAt = null;
    const waiting = async () => {
      try {
        await wait();
      } finally {
        endedAt = Date.now();
      }
    };
    const r = await runSkill(fakeBot(), waiting, {}, { hardCapS: 0.05 });
    const stoppedAt = Date.now();
    assert.strictEqual(r.reason, "timeout");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = endedAt === null ? "never" : `${endedAt - stoppedAt} ms`;
    assert.ok(endedAt !== null && endedAt - stoppedAt < 150, `ended ${after} after the stop`);
  }
});

test("a skill whose estimate is too long is refused before starting (too_long)", async () => {
  let started = false;
  const skill = async () => {
    started = true;
    return { success: true, reason: "ok", details: {} };
  };
  skill.budget = () => 200; // stopped at 3 x 200 + 10 s: more than the 300 s hard cap
  const r = await runSkill(fakeBot(), skill, {});
  assert.deepStrictEqual([r.reason, r.details.estimated_seconds, started], ["too_long", 200, false]);
  skill.budget = () => 10;
  assert.strictEqual((await runSkill(fakeBot(), skill, {})).reason, "ok");
});

test("a skill over its own budget is stopped (timeout, limit budget)", async () => {
  const skill = () => new Promise(() => {});
  skill.budget = () => -3.3; // stop time 3 x -3.3 + 10 = 0.1 s (a test shortcut)
  const r = await runSkill(fakeBot(), skill, {});
  assert.deepStrictEqual([r.reason, r.details.limit], ["timeout", "budget"]);
});

test("a skill that makes no progress is stopped (no_progress); moving counts as progress", async () => {
  const bot = fakeBot();
  const r = await runSkill(bot, () => new Promise(() => {}), {}, { noProgressS: 0.3 });
  assert.strictEqual(r.reason, "no_progress");
  const walking = async (b) => {
    for (let i = 0; i < 8; i++) {
      await sleep(100);
      b.entity.position.x += 1; // one block every 100 ms
    }
    return { success: true, reason: "ok", details: {} };
  };
  assert.strictEqual((await runSkill(bot, walking, {}, { noProgressS: 0.3 })).reason, "ok");
  // Not moving but the inventory changing (crafting, picking up) is progress too
  const crafter = fakeBot({ inventory: { oak_log: 8 } });
  const crafting = async (b) => {
    for (let i = 0; i < 8; i++) {
      await sleep(100);
      b.inventory.items()[0].count -= 1;
    }
    return { success: true, reason: "ok", details: {} };
  };
  assert.strictEqual((await runSkill(crafter, crafting, {}, { noProgressS: 0.3 })).reason, "ok");
});

test("an alert stops the skill: hurt, or a NEW monster close (not one already there)", async () => {
  const hurt = fakeBot();
  const r = await runSkill(hurt, async () => {
    hurt.health = 17;
    await new Promise(() => {});
  }, {});
  assert.deepStrictEqual([r.reason, r.details.trigger, r.details.health], ["alert", "damage", 17]);

  const monster = (id, name, x) => ({ id, type: "hostile", name, position: hurt.entity.position.offset(x, 0, 0) });
  // A monster already close at the start does not stop the skill (it may be the answer to it)
  const calm = fakeBot({ entities: { 1: monster(1, "zombie", 3) } });
  const r1 = await runSkill(calm, async () => {
    await sleep(600); // more than two checks of the watcher
    return { success: true, reason: "ok", details: {} };
  }, {});
  assert.strictEqual(r1.reason, "ok");
  // A NEW one coming close does (a husk, so that the alert says which one it was)
  const bot = fakeBot({ entities: { 1: monster(1, "zombie", 3) } });
  const r2 = await runSkill(bot, async () => {
    await sleep(400);
    bot.entities[2] = monster(2, "husk", 4);
    await new Promise(() => {});
  }, {});
  assert.deepStrictEqual([r2.reason, r2.details.trigger, r2.details.entity], ["alert", "hostile_near", "husk"]);
});

test("outside a skill, sleep and waitUntil are plain waits", async () => {
  await sleep(10);
  assert.strictEqual(await waitUntil(() => true, 100), true);
});
