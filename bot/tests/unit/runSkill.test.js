const test = require('node:test')
const assert = require('node:assert')
const runSkill = require('../../src/runSkill')
const { fakeBot } = require('./fakeBot')

test('a successful skill keeps its result and gets a duration', async () => {
    const r = await runSkill(fakeBot(), async () => ({ success: true, reason: 'ok', details: {} }), {})
    assert.strictEqual(r.success, true)
    assert.strictEqual(r.reason, 'ok')
    assert.strictEqual(typeof r.duration, 'number')
})

test('a skill that takes too long returns timeout and stops the pathfinder', async () => {
    const bot = fakeBot()
    let stopped = false
    bot.pathfinder.setGoal = (goal) => { if (goal === null) stopped = true }
    const r = await runSkill(bot, () => new Promise(() => {}), {}, 100)
    assert.strictEqual(r.reason, 'timeout')
    assert.strictEqual(stopped, true)
})

test('an exception becomes an "exception" failure', async () => {
    const r = await runSkill(fakeBot(), async () => { throw new Error('boom') }, {})
    assert.deepStrictEqual([r.success, r.reason, r.details.error], [false, 'exception', 'boom'])
})

test('a malformed result becomes "bad_result"', async () => {
    const r = await runSkill(fakeBot(), async () => 'not an object', {})
    assert.deepStrictEqual([r.success, r.reason], [false, 'bad_result'])
})
