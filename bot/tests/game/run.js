// Run the in-game test suite of one skill (or of all of them).
// Usage: node --env-file=../.env bot.js suite <skill|all> [number of trials]
//
// - "Nominal" cases: the skill must succeed. We run N trials (10 by default) and compute the
//   success rate (target >= 80 %). verify() checks the real world to catch "false successes"
//   (the skill says ok but nothing changed).
// - "Edge" cases: one trial each, the skill must return exactly the expected reason.
// Everything goes through execute(): every trial is logged with source "test:<skill>".

import execute from "../../src/execute.js";
import { observe } from "../../src/state.js";
import { prepareArena, resetArena } from "./arena.js";

const SUITES = [
    "move_to",
    "break_block",
    "pick_up",
    "collect_block",
    "place_block",
    "craft",
    "eat",
    "find",
    "scan",
    "explore",
    "mine",
    "walk",
    "press",
];

// One trial: setup, execution, verification
async function runTrial(bot, skill, testCase) {
    await resetArena(bot);
    try {
        if (testCase.setup) await testCase.setup(bot);
    } catch (e) {
        return { status: "setup_failed", message: e.message };
    }

    const before = observe(bot);
    // source tells the line comes from a test
    const r = await execute(bot, skill, testCase.args, `test:${skill}`);
    const after = observe(bot);

    let verified = true;
    if (testCase.verify && r.success) verified = await testCase.verify(r, before, after, bot);
    return { r, verified };
}

async function runSuite(bot, skill, n) {
    const { nominal, edgeCases } = await import(`./${skill}.js`);
    const report = {
        skill,
        succeeded: 0,
        trials: 0,
        falseSuccesses: 0,
        setupFailures: 0,
        edgeOk: 0,
        edgeTotal: edgeCases.length,
    };
    console.log(`\n=== ${skill}: ${n} nominal trials, ${edgeCases.length} edge cases ===`);

    for (let i = 0; i < n; i++) {
        const testCase = nominal[i % nominal.length];
        const res = await runTrial(bot, skill, testCase);
        if (res.status === "setup_failed") {
            report.setupFailures++;
            console.log(
                `  [${i + 1}] ${testCase.name}: SETUP FAILED (${res.message}), not counted`,
            );
            continue;
        }
        report.trials++;
        const { r, verified } = res;
        let mark = r.success ? "OK" : "FAILED";
        if (r.success && verified !== true) {
            report.falseSuccesses++;
            mark = `FALSE SUCCESS (${verified})`;
        } else if (r.success) {
            report.succeeded++;
        }
        console.log(
            `  [${i + 1}] ${testCase.name}: ${mark} ${r.reason} ${r.duration}s ${JSON.stringify(r.details)}`,
        );
    }

    for (const testCase of edgeCases) {
        const res = await runTrial(bot, skill, testCase);
        if (res.status === "setup_failed") {
            console.log(`  [edge] ${testCase.name}: SETUP FAILED (${res.message})`);
            continue;
        }
        const ok = res.r.reason === testCase.expect;
        if (ok) report.edgeOk++;
        console.log(
            `  [edge] ${testCase.name}: ${ok ? "OK" : "UNEXPECTED"} expected=${testCase.expect} got=${res.r.reason}`,
        );
    }

    const rate = report.trials ? Math.round((100 * report.succeeded) / report.trials) : 0;
    const passed = rate >= 80 && report.falseSuccesses === 0 && report.edgeOk === report.edgeTotal;
    console.log(
        `--- ${skill}: ${report.succeeded}/${report.trials} succeeded (${rate} %), false successes: ${report.falseSuccesses}, ` +
            `edge cases: ${report.edgeOk}/${report.edgeTotal}, setup failures: ${report.setupFailures} -> ${passed ? "PASSED" : "NOT PASSED"}`,
    );
    return { ...report, rate, passed };
}

async function run(bot, name, n) {
    const names = name === "all" ? SUITES : [name];
    if (!names.every((s) => SUITES.includes(s))) {
        console.log(`Unknown suite: ${name}. Choices: ${SUITES.join(", ")}, all`);
        return;
    }
    const trials = parseInt(n || "10", 10);

    await prepareArena(bot);
    const reports = [];
    for (const s of names) reports.push(await runSuite(bot, s, trials));

    if (reports.length > 1) {
        console.log("\n=== Summary ===");
        for (const r of reports)
            console.log(`  ${r.skill}: ${r.rate} % ${r.passed ? "PASSED" : "NOT PASSED"}`);
    }
}

export default run;
