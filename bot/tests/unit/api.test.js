const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { fakeBot } = require('./fakeBot')

// Temporary journal: fake lines are never written to data/transitions.jsonl
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-agent-api-')), 'transitions.jsonl')
process.env.TRANSITIONS_FILE = file
const { startApi } = require('../../src/api')
const skills = require('../../src/skills')
const { CATALOGUE, CATALOGUE_VERSION } = require('../../src/skills/catalogue')

const lastLine = () => JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1))

// Start the API on a free port (port 0 = "pick one") and return its base URL
async function api(bot) {
    const server = await startApi(bot, { port: 0 })
    test.after(() => server.close())
    return `http://127.0.0.1:${server.address().port}`
}
const post = (base, body) => fetch(`${base}/execute`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

test('the catalogue describes exactly the skills in the code', () => {
    assert.deepStrictEqual(Object.keys(CATALOGUE).sort(), Object.keys(skills).sort())
    for (const [name, entry] of Object.entries(CATALOGUE)) {
        assert.ok(entry.description.length > 20, `${name}: description too short`)
        assert.strictEqual(entry.parameters.type, 'object', `${name}: parameters must be an object JSON Schema`)
        for (const required of entry.parameters.required || []) assert.ok(required in entry.parameters.properties, `${name}: ${required}`)
        assert.ok(Object.keys(entry.reasons).length > 0, `${name}: no failure reason`)
    }
})

test('GET /skills and GET /state', async () => {
    const base = await api(fakeBot({ inventory: { bread: 2 } }))
    const s = await (await fetch(`${base}/skills`)).json()
    assert.strictEqual(s.catalogue_version, CATALOGUE_VERSION)
    assert.ok(s.skills.move_to && s.common_reasons.timeout)
    const state = await (await fetch(`${base}/state`)).json()
    assert.deepStrictEqual(state.inventory, { bread: 2 })
})

test('GET /state answers 503 when the bot is disconnected', async () => {
    const bot = fakeBot()
    bot.entity = undefined
    const r = await fetch(`${await api(bot)}/state`)
    assert.strictEqual(r.status, 503)
})

test('POST /execute runs the skill, returns the result and logs episode_id and step', async () => {
    const base = await api(fakeBot())
    const r = await post(base, { name: 'find', args: { target: 'no_such_thing' }, source: 'brain', episode_id: 'ep-1', step: 3 })
    assert.strictEqual(r.status, 200)
    const result = await r.json()
    assert.deepStrictEqual([result.success, result.reason], [false, 'unknown_target'])
    const line = lastLine()
    assert.deepStrictEqual([line.schema_version, line.source, line.episode_id, line.step], [1, 'brain', 'ep-1', 3])
})

test('POST /execute: unknown name = unknown_skill result (not an HTTP error)', async () => {
    const r = await post(await api(fakeBot()), { name: 'fly' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual((await r.json()).reason, 'unknown_skill')
})

test('POST /execute: malformed requests -> 400', async () => {
    const base = await api(fakeBot())
    for (const body of ['not json', '[]', { args: {} }, { name: 'find', args: [] }, { name: 'find', step: 1.5 }]) {
        const r = await post(base, body)
        assert.strictEqual(r.status, 400, JSON.stringify(body))
    }
})

test('POST /execute: one skill at a time -> 409 busy', async () => {
    const bot = fakeBot()
    bot.pathfinder.goto = () => new Promise((r) => setTimeout(r, 300)) // a move that takes a while
    const base = await api(bot)
    const [a, b] = await Promise.all([
        post(base, { name: 'move_to', args: { x: 0, y: 100, z: 0 } }),
        new Promise((r) => setTimeout(r, 50)).then(() => post(base, { name: 'scan' })),
    ])
    assert.deepStrictEqual([a.status, b.status], [200, 409])
})

test('unknown routes -> 404, wrong method -> 405', async () => {
    const base = await api(fakeBot())
    assert.strictEqual((await fetch(`${base}/nowhere`)).status, 404)
    assert.strictEqual((await fetch(`${base}/execute`)).status, 405)
})
