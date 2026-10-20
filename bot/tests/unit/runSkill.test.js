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
  const r = await runSkill(bot, () => new Promise(() => {}), {}, 100);
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
  const r = await runSkill(bot, slow, {}, 50);
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
  await runSkill(bot, () => new Promise(() => {}), {}, 20); // a skill that times out
  await bot.pathfinder.goto(); // called from outside a skill: allowed
  assert.strictEqual(calls, 1);
});

test("at the time limit the keys are released (the bot does not keep walking)", async () => {
  const bot = fakeBot();
  const holdForward = async (b) => {
    b.setControlState("forward", true);
    await new Promise(() => {});
  };
  const r = await runSkill(bot, holdForward, {}, 30);
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
    const r = await runSkill(fakeBot(), waiting, {}, 50);
    const stoppedAt = Date.now();
    assert.strictEqual(r.reason, "timeout");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = endedAt === null ? "never" : `${endedAt - stoppedAt} ms`;
    assert.ok(endedAt !== null && endedAt - stoppedAt < 150, `ended ${after} after the stop`);
  }
});

test("outside a skill, sleep and waitUntil are plain waits", async () => {
  await sleep(10);
  assert.strictEqual(await waitUntil(() => true, 100), true);
});
