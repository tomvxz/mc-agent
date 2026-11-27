// The contract between the body and the brain (docs/api_contract.json): the real API answers have every
// field the brain reads, with the right type. The Python side checks its fake body against the same file
// (brain/tests/test_contract.py): if the API changes, this test fails until the contract is updated, and
// then the Python one fails until the fake body is updated.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApi } from "../../src/api/api.js";
import { startRun } from "../../src/journal/run.js";
import { fakeBot, Point } from "./fakeBot.js";

const contract = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/api_contract.json"), "utf8"),
);

// Everything this test writes goes to a temporary folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-contract-"));
process.env.MC_DATA_DIR = tmp;
process.env.TRANSITIONS_FILE = path.join(tmp, "transitions.jsonl");

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// The problems of `value` against `shape` (see the "about" of the contract): a list of texts
function problems(value, shape, where = "") {
    if (typeof shape === "string")
        return shape.split("|").includes(typeOf(value))
            ? []
            : [`${where}: ${typeOf(value)} instead of ${shape}`];
    if (Array.isArray(shape)) {
        if (!Array.isArray(value)) return [`${where}: ${typeOf(value)} instead of a list`];
        return value.flatMap((item, i) => problems(item, shape[0], `${where}[${i}]`));
    }
    if (typeOf(value) !== "object") return [`${where}: ${typeOf(value)} instead of an object`];
    if (shape["*"])
        return Object.entries(value).flatMap(([k, v]) => problems(v, shape["*"], `${where}.${k}`));
    return Object.entries(shape).flatMap(([key, sub]) => {
        const name = key.replace(/\?$/, ""); // optional for the FAKE body only: the real one always sends it
        return name in value
            ? problems(value[name], sub, `${where}.${name}`)
            : [`${where}.${name}: missing`];
    });
}

test("the checker itself: types, unions, lists, '*' entries, missing fields", () => {
    const shape = {
        a: "number|null",
        list: [{ n: "string" }],
        map: { "*": { c: "number" } },
        "opt?": "boolean",
    };
    assert.deepStrictEqual(
        problems({ a: null, list: [{ n: "x" }], map: { k: { c: 1 } }, opt: true }, shape),
        [],
    );
    assert.deepStrictEqual(problems({ a: "1", list: [{}], map: { k: { c: "1" } } }, shape), [
        ".a: string instead of number|null",
        ".list[0].n: missing",
        ".map.k.c: string instead of number",
        ".opt: missing",
    ]);
});

test("the real API answers follow the contract (docs/api_contract.json)", async () => {
    // A bot with something to show: a cow nearby and a block in sight
    const bot = fakeBot({
        blocks: { "3,100,0": "oak_log" },
        entities: {
            5: {
                id: 5,
                name: "cow",
                type: "animal",
                position: new Point(4.5, 100, 2.5),
                height: 1.4,
            },
        },
    });
    await startRun(bot, { host: "h", port: 1, command: async () => null, codeVersion: "abc1234" });
    const server = await startApi(bot, { port: 0 });
    test.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;

    const answers = {
        "GET /run": await (await fetch(`${base}/run`)).json(),
        "GET /skills": await (await fetch(`${base}/skills`)).json(),
        "GET /state": await (await fetch(`${base}/state`)).json(),
        "POST /execute": await (
            await fetch(`${base}/execute`, {
                method: "POST",
                body: JSON.stringify({ name: "scan", args: {} }),
            })
        ).json(),
    };
    // The lists and maps checked must not be empty (an empty list would pass without checking anything)
    assert.ok(
        answers["GET /state"].entities.length > 0 &&
            Object.keys(answers["GET /state"].in_sight).length > 0,
    );

    const routes = Object.keys(contract).filter((k) => k !== "about");
    assert.deepStrictEqual(routes.sort(), Object.keys(answers).sort()); // every route of the contract is checked
    for (const route of routes)
        assert.deepStrictEqual(problems(answers[route], contract[route], route), [], route);
});
