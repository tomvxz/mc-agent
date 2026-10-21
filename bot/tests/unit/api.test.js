import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApi } from "../../src/api.js";
import { CATALOGUE, SHOWN_TO_LLM } from "../../src/skills/catalogue.js";
import skills from "../../src/skills/index.js";
import { fakeBot } from "./fakeBot.js";

// Temporary journal: fake lines are never written to data/transitions.jsonl
const file = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-api-")),
  "transitions.jsonl",
);
process.env.TRANSITIONS_FILE = file;

const lastLine = () =>
  JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n").at(-1));

// Start the API on a free port (port 0 = "pick one") and return its base URL
async function api(bot) {
  const server = await startApi(bot, { port: 0 });
  test.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body) =>
  fetch(`${base}/execute`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("the catalogue describes exactly the skills in the code", () => {
  assert.deepStrictEqual(
    Object.keys(CATALOGUE).sort(),
    Object.keys(skills).sort(),
  );
  for (const [name, entry] of Object.entries(CATALOGUE)) {
    assert.ok(entry.description.length > 20, `${name}: description too short`);
    assert.strictEqual(
      entry.parameters.type,
      "object",
      `${name}: parameters must be an object JSON Schema`,
    );
    for (const required of entry.parameters.required || [])
      assert.ok(
        required in entry.parameters.properties,
        `${name}: ${required}`,
      );
    assert.ok(
      Object.keys(entry.reasons).length > 0,
      `${name}: no failure reason`,
    );
  }
});

test("GET /skills shows only SHOWN_TO_LLM; ?all=1 shows every skill", async () => {
  const base = await api(fakeBot());
  const shown = await (await fetch(`${base}/skills`)).json();
  assert.deepStrictEqual(
    Object.keys(shown.skills).sort(),
    [...SHOWN_TO_LLM].sort(),
  );
  const all = await (await fetch(`${base}/skills?all=1`)).json();
  assert.deepStrictEqual(
    Object.keys(all.skills).sort(),
    Object.keys(CATALOGUE).sort(),
  );
  // Every shown name is a real skill
  for (const name of SHOWN_TO_LLM) assert.ok(skills[name], name);
});

test("GET /skills and GET /state", async () => {
  const base = await api(fakeBot({ inventory: { bread: 2 } }));
  const s = await (await fetch(`${base}/skills`)).json();
  assert.ok(s.skills.move_to && s.common_reasons.timeout);
  const state = await (await fetch(`${base}/state`)).json();
  assert.deepStrictEqual(state.inventory, { bread: 2 });
});

test("GET /state answers 503 when the bot is disconnected", async () => {
  const bot = fakeBot();
  bot.entity = undefined;
  const r = await fetch(`${await api(bot)}/state`);
  assert.strictEqual(r.status, 503);
});

test("POST /execute runs the skill, returns the result and logs episode_id and turn", async () => {
  const base = await api(fakeBot());
  const r = await post(base, {
    name: "find",
    args: { target: "no_such_thing" },
    source: "brain",
    episode_id: "ep-1",
    turn: 1,
  });
  assert.strictEqual(r.status, 200);
  const result = await r.json();
  assert.deepStrictEqual(
    [result.success, result.reason],
    [false, "unknown_target"],
  );
  const line = lastLine();
  assert.deepStrictEqual(
    [line.schema_version, line.source, line.episode_id, line.turn],
    [8, "brain", "ep-1", 1],
  );
});

test("POST /execute: unknown name = unknown_skill result (not an HTTP error)", async () => {
  const r = await post(await api(fakeBot()), { name: "fly" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).reason, "unknown_skill");
});

test("POST /execute: malformed requests -> 400", async () => {
  const base = await api(fakeBot());
  const bad = [
    "not json",
    "[]",
    { args: {} },
    { name: "find", args: [] },
    { name: "find", turn: 1.5 },
    { name: "find", turn: "1" },
    { name: "find", step: 3 },
  ];
  for (const body of bad) {
    const r = await post(base, body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
});

test("POST /setup: malformed requests -> 400 (nothing is sent to the server)", async () => {
  const bot = fakeBot();
  const sent = [];
  bot.chat = (text) => sent.push(text);
  const base = await api(bot);
  const bad = [
    "[]",
    { z: 0 },
    { x: 1.5, z: 0 },
    { x: 0, z: 0, inventory: [] },
    { x: 0, z: 0, inventory: { not_an_item: 1 } },
    { x: 0, z: 0, inventory: { dirt: 0 } },
    { x: 0, z: 0, y: 64 },
  ];
  for (const body of bad) {
    const r = await fetch(`${base}/setup`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
  assert.deepStrictEqual(sent, []);
});

test("POST /execute: one skill at a time -> 409 busy", async () => {
  const bot = fakeBot();
  bot.pathfinder.goto = () => new Promise((r) => setTimeout(r, 300)); // a move that takes a while
  const base = await api(bot);
  const [a, b] = await Promise.all([
    post(base, { name: "move_to", args: { x: 0, y: 100, z: 0 } }),
    new Promise((r) => setTimeout(r, 50)).then(() =>
      post(base, { name: "scan" }),
    ),
  ]);
  assert.deepStrictEqual([a.status, b.status], [200, 409]);
});

test("GET /run answers 503 before the run has started", async () => {
  const r = await fetch(`${await api(fakeBot())}/run`);
  assert.strictEqual(r.status, 503);
});

test("unknown routes -> 404, wrong method -> 405", async () => {
  const base = await api(fakeBot());
  assert.strictEqual((await fetch(`${base}/nowhere`)).status, 404);
  assert.strictEqual((await fetch(`${base}/execute`)).status, 405);
});
