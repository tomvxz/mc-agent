const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { fakeBot } = require('./fakeBot')

// Journal temporaire : on n'écrit jamais de fausses lignes dans data/transitions.jsonl
const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-agent-')), 'transitions.jsonl')
process.env.TRANSITIONS_FILE = fichier
const execute = require('../../src/execute')

const lignes = () => fs.readFileSync(fichier, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

test('un nom inconnu échoue ET est journalisé', async () => {
    const r = await execute(fakeBot(), 'voler', {}, 'unit')
    assert.deepStrictEqual([r.success, r.reason], [false, 'unknown_skill'])
    const derniere = lignes().at(-1)
    assert.strictEqual(derniere.reason, 'unknown_skill')
    assert.strictEqual(derniere.skill.name, 'voler')
    assert.deepStrictEqual(derniere.state, derniere.next_state)
})

test('un nom hérité de JavaScript ("constructor") n\'est pas une compétence', async () => {
    const r = await execute(fakeBot(), 'constructor', {}, 'unit')
    assert.strictEqual(r.reason, 'unknown_skill')
})

test('une vraie compétence est journalisée avec state, next_state et duration', async () => {
    const r = await execute(fakeBot(), 'mine', { block: 'truc' }, 'unit')
    assert.strictEqual(r.reason, 'unknown_block')
    const d = lignes().at(-1)
    for (const champ of ['ts', 'source', 'state', 'skill', 'next_state', 'success', 'reason', 'duration']) {
        assert.ok(champ in d, `champ manquant : ${champ}`)
    }
    assert.strictEqual(d.source, 'unit')
})

test('si observe plante (bot déconnecté), la transition est quand même écrite avec state null', async () => {
    const bot = fakeBot()
    bot.entity = undefined
    await execute(bot, 'mine', { block: 'truc' }, 'unit')
    const d = lignes().at(-1)
    assert.strictEqual(d.state, null)
    assert.strictEqual(d.reason, 'unknown_block')
})
