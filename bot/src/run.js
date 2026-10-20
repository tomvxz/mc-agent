// A "run" = one launch of the bot process. Every journal line carries its run_id, and the run's
// fixed facts (versions, world seed, server settings) are written ONCE in runs.jsonl.
//
// Purpose (env MC_DATA_PURPOSE):
//   dev        (default) everything we produce while building the bot: data/dev/      -> disposable
//   collection a real data-collection run:                         data/collection/<run_id>/
// so development data is never mixed with collection data.

import pathfinderPackage from "mineflayer-pathfinder/package.json" with { type: "json" };
import mineflayerPackage from "mineflayer/package.json" with { type: "json" };
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { logRun } from "./logger.js";
import { CODE_VERSION } from "./version.js";

const PURPOSES = ["dev", "collection"];
const RUN_SCHEMA_VERSION = 1;

let current = null; // the current run, or null (unit tests run without one)

function dataRoot() {
    return (
        process.env.MC_DATA_DIR ||
        path.resolve(import.meta.dirname, "../../data")
    );
}

function newRunId() {
    const t = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace("T", "-")
        .slice(0, 15); // 20261019-104512
    return `run-${t}-${crypto.randomBytes(2).toString("hex")}`;
}

function dataDirFor(purpose, runId) {
    return purpose === "collection"
        ? path.join(dataRoot(), "collection", runId)
        : path.join(dataRoot(), "dev");
}

// The login packet tells the server's view and simulation distances (they change what the bot
// sees and what is simulated around it): keep them for run_start. Call before the bot logs in.
function watchLogin(bot) {
    bot._client.once("login", (packet) => {
        bot.serverSettings = {
            view_distance: packet.viewDistance,
            simulation_distance: packet.simulationDistance,
        };
    });
}

// /version first answers "Checking version, please wait...": wait for the line saying what runs
function askServerVersion(bot, command, maxMs = 5000) {
    const answer = new Promise((resolve) => {
        const finish = (msg) => {
            clearTimeout(timer);
            bot.removeListener("messagestr", onMessage);
            resolve(msg);
        };
        const onMessage = (msg) => {
            if (/running/i.test(msg)) finish(msg);
        };
        const timer = setTimeout(() => finish(null), maxMs);
        bot.on("messagestr", onMessage);
    });
    command(bot, "/version", 500);
    return answer;
}

// Data meant for training must come from an exact, findable code version: the git commit. So a
// collection run refuses to start if the code has uncommitted changes ("+dirty") or no commit.
// (This replaces hand-written version numbers per skill, which could lie: a fix in a shared file
// changes every skill without anybody bumping their numbers.) Returns an error message, or null.
function collectionProblem(purpose, codeVersion) {
    if (purpose !== "collection") return null;
    if (codeVersion === "unknown")
        return "collection needs a git checkout (the code version is unknown)";
    if (codeVersion.endsWith("+dirty"))
        return "collection needs committed code: commit bot/ and brain/ first";
    return null;
}

// Called once, right after the bot spawns. `command` sends a server command (see commands.js).
// codeVersion: the git commit (given by unit tests only).
async function startRun(
    bot,
    { host, port, command, codeVersion = CODE_VERSION },
) {
    const purpose = process.env.MC_DATA_PURPOSE || "dev";
    if (!PURPOSES.includes(purpose))
        throw new Error(
            `MC_DATA_PURPOSE must be one of ${PURPOSES.join(", ")}, got "${purpose}"`,
        );
    const problem = collectionProblem(purpose, codeVersion);
    if (problem) throw new Error(problem);
    const runId = newRunId();
    const dataDir = dataDirFor(purpose, runId);

    // Tick rate announced by the server (1.20.3+). Mineflayer ignores it: its physics always runs at
    // 20 ticks/s, so any other rate makes the data unreliable. Recorded in run_start (and changes in traces).
    bot.tickRate = 20;
    bot._client.on("set_ticking_state", (packet) => {
        bot.tickRate = packet.tick_rate;
    });

    // World seed and server build, asked once (level-seed is empty in server.properties: random seed)
    const seedAnswer = await command(bot, "/seed", 2000);
    const seed = seedAnswer && (seedAnswer.match(/\[(-?\d+)\]/) || [])[1];
    const versionAnswer = await askServerVersion(bot, command);

    current = {
        schema_version: RUN_SCHEMA_VERSION,
        type: "run_start",
        run_id: runId,
        ts: new Date().toISOString(),
        purpose,
        data_dir: dataDir,
        bot: bot.username,
        world_id: process.env.MC_WORLD_ID || `${host}:${port}`,
        world_seed: seed ?? null,
        versions: {
            code: codeVersion,
            minecraft: bot.version,
            server: versionAnswer ? versionAnswer.slice(0, 200) : null, // e.g. "This server is running Paper version ..."
            mineflayer: mineflayerPackage.version,
            pathfinder: pathfinderPackage.version,
            node: process.version,
        },
        game: {
            difficulty: bot.game.difficulty ?? null, // the WORLD's difficulty (may differ from server.properties)
            game_mode: bot.game.gameMode,
            dimension: bot.game.dimension,
            tick_rate: bot.tickRate, // 20 unless the server says otherwise; later changes are trace events
            view_distance: bot.serverSettings?.view_distance ?? null,
            simulation_distance:
                bot.serverSettings?.simulation_distance ?? null,
        },
        host: os.hostname(),
    };
    logRun(current);
    return current;
}

function currentRun() {
    return current;
}

export {
    collectionProblem,
    currentRun,
    dataDirFor,
    newRunId,
    PURPOSES,
    startRun,
    watchLogin,
};
