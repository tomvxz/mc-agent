// The trace (src/journal/trace.js): what happens WHILE a skill runs. It is raw material of the world model,
// so every kind of event is checked here, and that recording a skill leaves nothing behind.
// The events already covered through execute() (damage, health
// loss, teleport, correction, death) are in execute.test.js.
import assert from "node:assert";
import test from "node:test";
import { startTrace, summarizeForBrain } from "../../src/journal/trace.js";
import { fakeBot } from "./fakeBot.js";

// A fake bot with what the physics tick reads
function tracedBot() {
    const bot = fakeBot();
    Object.assign(bot.entity, {
        id: 7,
        yaw: 0,
        pitch: 0,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
    });
    return bot;
}

test("trace: pickup, heal, respawn, weather, kick, disconnection, pathfinder and tick-rate events", () => {
    const bot = tracedBot();
    bot.health = 10;
    const stop = startTrace(bot);
    const log = { id: 9, getDroppedItem: () => ({ name: "oak_log", count: 2 }) };
    bot.emit("playerCollect", bot.entity, log); // the bot picks up 2 logs
    bot.emit("playerCollect", { id: 99 }, log); // another entity picks something up: not ours
    bot.health = 13;
    bot.emit("health");
    bot.emit("respawn");
    Object.assign(bot, { isRaining: true, rainState: 0.5, thunderState: 0 });
    bot.emit("weatherUpdate");
    bot.emit("kicked", "too fast");
    bot.emit("end");
    bot.emit("path_update", { status: "success", path: [1, 2, 3], visitedNodes: 40 });
    bot.emit("path_reset", "stuck");
    bot.emit("goal_reached");
    bot._client.emit("set_ticking_state", { tick_rate: 10, is_frozen: false });
    const t = stop();

    const byType = Object.fromEntries(t.events.map((e) => [e.type, e]));
    assert.deepStrictEqual(
        t.events.map((e) => e.type),
        [
            "pickup",
            "heal",
            "respawn",
            "weather",
            "kicked",
            "disconnected",
            "path_update",
            "path_reset",
            "goal_reached",
            "tick_rate",
        ],
    );
    assert.deepStrictEqual([byType.pickup.item, byType.pickup.count], ["oak_log", 2]);
    assert.deepStrictEqual([byType.heal.amount, byType.heal.health], [3, 13]);
    assert.deepStrictEqual([byType.weather.raining, byType.weather.rain_level], [true, 0.5]);
    assert.strictEqual(byType.kicked.reason, "too fast");
    assert.deepStrictEqual([byType.path_update.length, byType.path_update.visited], [3, 40]);
    assert.strictEqual(byType.path_reset.reason, "stuck");
    assert.deepStrictEqual([byType.tick_rate.tick_rate, byType.tick_rate.frozen], [10, false]);
    // Every event has its time since the start and the world age
    for (const e of t.events)
        assert.ok(Number.isFinite(e.ms) && e.tick === 5000, JSON.stringify(e));
});

test("trace: a block that keeps its type, or farther than 16 blocks, is not a block change", () => {
    const bot = tracedBot();
    const stop = startTrace(bot);
    const at = (dx) => bot.entity.position.floored().offset(dx, 0, 0);
    const block = (name, dx) => ({
        type: bot.registry.blocksByName[name].id,
        name,
        position: at(dx),
    });
    bot.emit("blockUpdate", block("oak_log", 2), block("oak_log", 2)); // a state change (axis): same type
    bot.emit("blockUpdate", block("stone", 20), block("air", 20)); // too far
    bot.emit("blockUpdate", block("stone", 3), block("air", 3)); // kept
    const t = stop();
    assert.deepStrictEqual(
        t.blocks.rows.map((r) => r.slice(1)),
        [[3, 100, 0, "stone", "air"]],
    );
});

test("trace: only the action packets are kept, with their fields", () => {
    const bot = tracedBot();
    const stop = startTrace(bot);
    bot._client.write("window_click", {
        windowId: 1,
        slot: 4,
        mouseButton: 1,
        mode: 0,
        stateId: 3,
    });
    bot._client.write("use_entity", { target: 12, mouse: 1 });
    bot._client.write("held_item_slot", { slotId: 2 });
    bot._client.write("position", { x: 0, y: 0, z: 0 }); // movement: not an action (it is in the body rows)
    const t = stop();
    assert.deepStrictEqual(
        t.actions.map(({ ms, ...a }) => a),
        [
            { packet: "window_click", window: 1, slot: 4, button: 1, mode: 0 },
            { packet: "use_entity", target: 12, mouse: 1 },
            { packet: "held_item_slot", slot: 2 },
        ],
    );
});

test("trace: past its cap a series is truncated, and says so", () => {
    const bot = tracedBot();
    const stop = startTrace(bot);
    for (let i = 0; i < 510; i++) bot.emit("goal_reached"); // the events cap is 500
    const t = stop();
    assert.strictEqual(t.events.length, 500);
    assert.deepStrictEqual(t.truncated, ["events"]);
});

test("trace: stopping removes every listener, and the packet watcher is installed once per bot", () => {
    const bot = tracedBot();
    const watched = [
        "physicsTick",
        "health",
        "blockUpdate",
        "playerCollect",
        "forcedMove",
        "death",
    ];
    const before = watched.map((name) => bot.listenerCount(name));
    for (let i = 0; i < 3; i++) startTrace(bot)(); // three skills, one after the other
    assert.deepStrictEqual(
        watched.map((name) => bot.listenerCount(name)),
        before,
    );
    // A packet sent during the NEXT skill goes into its trace only, not into a trace already stopped
    const write = bot._client.write;
    const first = startTrace(bot)();
    const stopSecond = startTrace(bot);
    bot._client.write("block_dig", { status: 0, location: { x: 0, y: 0, z: 0 }, face: 1 });
    const second = stopSecond();
    assert.deepStrictEqual([first.actions.length, second.actions.length], [0, 1]);
    assert.strictEqual(bot._client.write, write); // the client's write is wrapped once, not once per skill
});

test("trace: the brain's summary adds the health losses and says if the bot died", () => {
    const events = [
        { type: "health_loss", amount: 2.5 },
        { type: "heal", amount: 1 },
        { type: "health_loss", amount: 4 },
    ];
    assert.deepStrictEqual(summarizeForBrain({ events }), { damage_taken: 6.5, died: false });
    assert.deepStrictEqual(summarizeForBrain({ events: [{ type: "death" }] }), {
        damage_taken: 0,
        died: true,
    });
    assert.deepStrictEqual(summarizeForBrain(null), { damage_taken: 0, died: false }); // unknown skill: no trace
});
