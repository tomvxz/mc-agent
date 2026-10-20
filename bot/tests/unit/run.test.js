import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fixDifficulty } from "../../src/fixes.js";
import { collectionProblem, currentRun, dataDirFor, newRunId, startRun } from "../../src/run.js";
import { fakeBot } from "./fakeBot.js";

// Everything goes to a temporary data folder
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-run-"));
process.env.MC_DATA_DIR = root;

// A fake command sender answering like the server
const fakeCommand = async (bot, text) => {
    if (text === "/seed") return "Seed: [-123456789]";
    bot.emit("messagestr", "Checking version, please wait..."); // Paper answers in two lines
    bot.emit("messagestr", "This server is running Paper version 1.21.11");
    return "Checking version, please wait...";
};

test("fixDifficulty: the difficulty arrives as text and is kept", async () => {
    const bot = fakeBot();
    fixDifficulty(bot);
    bot._client.on("difficulty", () => {
        bot.game.difficulty = undefined;
    }); // like Mineflayer's own listener
    bot._client.emit("difficulty", { difficulty: "normal", difficultyLocked: false });
    await Promise.resolve(); // let the microtask run
    assert.strictEqual(bot.game.difficulty, "normal");
});

test("run ids and data folders", () => {
    assert.match(newRunId(), /^run-\d{8}-\d{6}-[0-9a-f]{4}$/);
    assert.strictEqual(dataDirFor("dev"), path.join(root, "dev"));
    assert.strictEqual(dataDirFor("collection", "run-x"), path.join(root, "collection", "run-x"));
});

test("an invalid purpose is refused", async () => {
    process.env.MC_DATA_PURPOSE = "oops";
    await assert.rejects(
        startRun(fakeBot(), { host: "h", port: 1, command: fakeCommand }),
        /MC_DATA_PURPOSE/,
    );
    delete process.env.MC_DATA_PURPOSE;
});

test("a collection run writes run_start in its own folder, with versions and the seed", async () => {
    process.env.MC_DATA_PURPOSE = "collection";
    const bot = fakeBot();
    bot.version = "1.21.11";
    const run = await startRun(bot, {
        host: "localhost",
        port: 25565,
        command: fakeCommand,
        codeVersion: "abc1234",
    });
    delete process.env.MC_DATA_PURPOSE;
    assert.strictEqual(currentRun(), run);
    assert.strictEqual(run.versions.code, "abc1234");
    assert.strictEqual(run.data_dir, path.join(root, "collection", run.run_id));
    const line = JSON.parse(fs.readFileSync(path.join(run.data_dir, "runs.jsonl"), "utf8").trim());
    assert.strictEqual(line.type, "run_start");
    assert.strictEqual(line.world_seed, "-123456789");
    assert.strictEqual(line.world_id, "localhost:25565");
    assert.strictEqual(line.versions.minecraft, "1.21.11");
    assert.ok(!("skills" in line.versions) && !("catalogue" in line.versions)); // replaced by the commit
    assert.match(line.versions.server, /Paper/);
    // The tick rate announced by the server is followed
    bot._client.emit("set_ticking_state", { tick_rate: 40, is_frozen: false });
    assert.strictEqual(bot.tickRate, 40);
});

test("a collection run refuses to start with uncommitted code", async () => {
    process.env.MC_DATA_PURPOSE = "collection";
    await assert.rejects(
        startRun(fakeBot(), {
            host: "h",
            port: 1,
            command: fakeCommand,
            codeVersion: "abc1234+dirty",
        }),
        /commit/,
    );
    delete process.env.MC_DATA_PURPOSE;
});

test("a collection run needs committed code (the commit identifies the code exactly)", () => {
    assert.strictEqual(collectionProblem("dev", "6fc30a3+dirty"), null); // development: anything goes
    assert.strictEqual(collectionProblem("collection", "6fc30a3"), null);
    assert.match(collectionProblem("collection", "6fc30a3+dirty"), /commit/);
    assert.match(collectionProblem("collection", "unknown"), /git/);
});
