const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { fakeBot } = require('./fakeBot')

// Temporary journal: fake lines are never written to data/transitions.jsonl
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-agent-')), 'transitions.jsonl')
process.env.TRANSITIONS_FILE = file
const execute = require('../../src/execute')

const lines = () => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

test('an unknown name fails AND is logged', async () => {
    const r = await execute(fakeBot(), 'fly', {}, 'unit')
    assert.deepStrictEqual([r.success, r.reason], [false, 'unknown_skill'])
    const last = lines().at(-1)
    assert.strictEqual(last.reason, 'unknown_skill')
    assert.strictEqual(last.skill.name, 'fly')
    assert.deepStrictEqual(last.state, last.next_state)
})

test('a name inherited from JavaScript ("constructor") is not a skill', async () => {
    const r = await execute(fakeBot(), 'constructor', {}, 'unit')
    assert.strictEqual(r.reason, 'unknown_skill')
})

test('a real skill is logged with state, next_state and duration', async () => {
    const r = await execute(fakeBot(), 'mine', { block: 'no_such_block' }, 'unit')
    assert.strictEqual(r.reason, 'unknown_block')
    const d = lines().at(-1)
    for (const field of ['ts', 'source', 'state', 'skill', 'next_state', 'success', 'reason', 'duration']) {
        assert.ok(field in d, `missing field: ${field}`)
    }
    assert.strictEqual(d.source, 'unit')
})

test('if observe throws (bot disconnected), the transition is still written with state null', async () => {
    const bot = fakeBot()
    bot.entity = undefined
    await execute(bot, 'mine', { block: 'no_such_block' }, 'unit')
    const d = lines().at(-1)
    assert.strictEqual(d.state, null)
    assert.strictEqual(d.reason, 'unknown_block')
})
