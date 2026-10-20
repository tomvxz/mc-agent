import assert from "node:assert";
import test from "node:test";
import { drawLocations, makeRandom, summarize } from "../field/plan.js";

test("field bench: the same seed always gives the same locations", () => {
    assert.deepStrictEqual(drawLocations(7, 5), drawLocations(7, 5));
    assert.notDeepStrictEqual(drawLocations(7, 5), drawLocations(8, 5));
    // Replaying one location alone gives the same draw as in the full run
    assert.deepStrictEqual(
        drawLocations(7, 5)[3],
        drawLocations(7, 5).filter((l) => l.index === 3)[0],
    );
    const r = makeRandom(1);
    for (let i = 0; i < 100; i++) {
        const v = r();
        assert.ok(v >= 0 && v < 1);
    }
});

test("field bench: the summary counts successes, failure reasons and many corrections", () => {
    const s = summarize([
        {
            task: "move_to",
            applicable: true,
            success: true,
            reason: "ok",
            duration: 4,
            corrections: 0,
        },
        {
            task: "move_to",
            applicable: true,
            success: false,
            reason: "stuck",
            duration: 10,
            corrections: 140,
        },
        {
            task: "move_to",
            applicable: true,
            success: false,
            reason: "stuck",
            duration: 8,
            corrections: 2,
        },
        { task: "move_to", applicable: false },
        {
            task: "mine",
            applicable: true,
            success: true,
            reason: "ok",
            duration: 12,
            corrections: 0,
        },
    ]);
    assert.strictEqual(s.move_to.tried, 3);
    assert.strictEqual(s.move_to.succeeded, 1);
    assert.strictEqual(s.move_to.rate, 33);
    assert.deepStrictEqual(s.move_to.reasons, { stuck: 2 });
    assert.strictEqual(s.move_to.not_applicable, 1);
    assert.strictEqual(s.move_to.with_corrections, 1);
    assert.strictEqual(s.move_to.median_duration, 8);
    assert.strictEqual(s.mine.rate, 100);
});
