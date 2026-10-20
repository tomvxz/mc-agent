import mineflayer from "mineflayer";
import mineflayerPathfinder from "mineflayer-pathfinder";
import { startApi } from "./src/api.js";
import { runCommand } from "./src/commands.js";
import { fixDifficulty, fixStateId, fixWallContact } from "./src/fixes.js";
import { getMovements } from "./src/movements.js";
import { startRun, watchLogin } from "./src/run.js";
import { trackDeaths } from "./src/state.js";
const { pathfinder } = mineflayerPathfinder;

const host = process.env.MC_HOST || "localhost";
const port = parseInt(process.env.MC_PORT || "25565", 10);
const bot = mineflayer.createBot({
    host,
    port,
    username: process.env.MC_USERNAME || "Agent",
    version: process.env.MC_VERSION,
});
bot.loadPlugin(pathfinder);
fixStateId(bot); // see src/fixes.js
fixDifficulty(bot);
fixWallContact(); // see src/fixes.js: the bot froze against every wall
watchLogin(bot); // view and simulation distances, for run_start
trackDeaths(bot); // deaths count, part of the state

bot.on("error", (err) => console.error("[error]", err.message));
bot.on("kicked", (reason) => console.error("[kicked]", reason));
bot.on("end", (reason) => console.log("[disconnected]", reason));

bot.once("spawn", async () => {
    bot.pathfinder.setMovements(getMovements(bot)); // resourceful movement, see src/movements.js
    // One run per launch: run_id, data folder (dev or collection), versions, world seed (src/run.js)
    try {
        const run = await startRun(bot, { host, port, command: runCommand });
        console.log(`[run] ${run.run_id} (${run.purpose}) -> ${run.data_dir}`);
    } catch (e) {
        console.error("[run] cannot start:", e.message);
        bot.quit();
        return;
    }
    // What to do: serve (API for the brain), suite <skill|all> [N] (arena tests), field [N] [seed] [only]
    const test = process.argv[2];

    if (test === "serve") {
        // API mode: the bot stays connected and waits for orders from the brain (see src/api.js)
        // node --env-file=../.env bot.js serve
        const apiPort = parseInt(process.env.API_PORT || "3000", 10);
        await startApi(bot, { port: apiPort });
        console.log(
            `[api] ready on http://127.0.0.1:${apiPort} (GET /state, GET /skills, GET /run, POST /execute)`,
        );
        // If the bot is disconnected the API is useless: exit so the brain notices
        bot.on("end", () => process.exit(1));
        return; // no bot.quit(): the bot stays online
    }

    if (test === "suite") {
        // In-game test suite: node --env-file=../.env bot.js suite move_to 10
        try {
            // loaded only in this mode: the test files are not needed otherwise
            const { default: runSuites } = await import("./tests/game/run.js");
            await runSuites(bot, process.argv[3], process.argv[4]);
        } catch (e) {
            console.error("[suite] error:", e);
        }
    }

    if (test === "field") {
        // Field bench in the real world: node --env-file=../.env bot.js field [locations] [seed] [only]
        try {
            const { default: runField } = await import("./tests/field/run.js");
            await runField(
                bot,
                process.argv[3],
                process.argv[4],
                process.argv[5],
            );
        } catch (e) {
            console.error("[field] error:", e);
        }
    }

    bot.quit(); // end the program once the test is done
});
