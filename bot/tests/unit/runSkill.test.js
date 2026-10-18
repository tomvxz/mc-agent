const test = require('node:test')
const assert = require('node:assert')
const runSkill = require('../../src/runSkill')
const { fakeBot } = require('./fakeBot')

test('une compétence qui réussit garde son résultat et reçoit une durée', async () => {
    const r = await runSkill(fakeBot(), async () => ({ success: true, reason: 'ok', details: {} }), {})
    assert.strictEqual(r.success, true)
    assert.strictEqual(r.reason, 'ok')
    assert.strictEqual(typeof r.duration, 'number')
})

test('une compétence trop longue renvoie timeout et arrête le pathfinder', async () => {
    const bot = fakeBot()
    let arret = false
    bot.pathfinder.setGoal = (goal) => { if (goal === null) arret = true }
    const r = await runSkill(bot, () => new Promise(() => {}), {}, 100)
    assert.strictEqual(r.reason, 'timeout')
    assert.strictEqual(arret, true)
})

test('une exception devient un échec "exception"', async () => {
    const r = await runSkill(fakeBot(), async () => { throw new Error('boum') }, {})
    assert.deepStrictEqual([r.success, r.reason, r.details.error], [false, 'exception', 'boum'])
})

test('un résultat mal formé devient "bad_result"', async () => {
    const r = await runSkill(fakeBot(), async () => 'pas un objet', {})
    assert.deepStrictEqual([r.success, r.reason], [false, 'bad_result'])
})
