import assert from "node:assert";
import test from "node:test";
import { getMovements } from "../../src/movements.js";
import { fakeBot, Point } from "./fakeBot.js";

test("the step cost accepts the placeholder of an unloaded cell (no position)", () => {
    const m = getMovements(fakeBot());
    const stepCost = m.exclusionAreasStep[0];
    // What the pathfinder passes for a cell in an unloaded chunk (seen in game: it crashed the bot)
    assert.strictEqual(stepCost({ safe: false, physical: false, height: 0 }), 0);
});

test("the step cost: free cell 0, near a monster 20, on magma 100", () => {
    const bot = fakeBot({ blocks: { "5,99,0": "magma_block" } });
    const m = getMovements(bot);
    const stepCost = m.exclusionAreasStep[0];
    assert.strictEqual(stepCost({ position: new Point(0, 100, 0) }), 0);
    assert.strictEqual(stepCost({ position: new Point(5, 100, 0) }), 100); // standing on magma
    bot.entities = { 1: { type: "hostile", name: "zombie", position: new Point(10, 100, 0) } };
    const m2 = getMovements(fakeBot({ entities: bot.entities }));
    assert.strictEqual(m2.exclusionAreasStep[0]({ position: new Point(11, 100, 0) }), 20);
});
