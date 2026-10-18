const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { fakeBot } = require('./fakeBot')

// Journal temporaire : on n'écrit jamais de fausses lignes dans data/transitions.jsonl
const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-agent-api-')), 'transitions.jsonl')
process.env.TRANSITIONS_FILE = fichier
const { demarrerApi } = require('../../src/api')
const skills = require('../../src/skills')
const { CATALOGUE } = require('../../src/skills/catalogue')

const derniereLigne = () => JSON.parse(fs.readFileSync(fichier, 'utf8').trim().split('\n').at(-1))

// Démarre l'API sur un port libre (port 0 = "choisis-en un") et renvoie l'adresse de base
async function api(bot) {
    const serveur = await demarrerApi(bot, { port: 0 })
    test.after(() => serveur.close())
    return `http://127.0.0.1:${serveur.address().port}`
}
const poster = (base, corps) => fetch(`${base}/execute`, { method: 'POST', body: typeof corps === 'string' ? corps : JSON.stringify(corps) })

test('le catalogue décrit exactement les compétences du code', () => {
    assert.deepStrictEqual(Object.keys(CATALOGUE).sort(), Object.keys(skills).sort())
    for (const [nom, fiche] of Object.entries(CATALOGUE)) {
        assert.ok(fiche.description.length > 20, `${nom} : description trop courte`)
        assert.strictEqual(fiche.parameters.type, 'object', `${nom} : parameters doit être un JSON Schema d'objet`)
        for (const requis of fiche.parameters.required || []) assert.ok(requis in fiche.parameters.properties, `${nom} : ${requis}`)
        assert.ok(Object.keys(fiche.reasons).length > 0, `${nom} : aucune raison d'échec`)
    }
})

test('GET /skills et GET /state', async () => {
    const base = await api(fakeBot({ inventory: { bread: 2 } }))
    const s = await (await fetch(`${base}/skills`)).json()
    assert.strictEqual(s.catalogue_version, 1)
    assert.ok(s.skills.move_to && s.common_reasons.timeout)
    const etat = await (await fetch(`${base}/state`)).json()
    assert.deepStrictEqual(etat.inventory, { bread: 2 })
})

test('GET /state répond 503 si le bot est déconnecté', async () => {
    const bot = fakeBot()
    bot.entity = undefined
    const r = await fetch(`${await api(bot)}/state`)
    assert.strictEqual(r.status, 503)
})

test('POST /execute exécute, renvoie le résultat et journalise episode_id et step', async () => {
    const base = await api(fakeBot())
    const r = await poster(base, { name: 'find', args: { target: 'truc' }, source: 'brain', episode_id: 'ep-1', step: 3 })
    assert.strictEqual(r.status, 200)
    const resultat = await r.json()
    assert.deepStrictEqual([resultat.success, resultat.reason], [false, 'unknown_target'])
    const ligne = derniereLigne()
    assert.deepStrictEqual([ligne.schema_version, ligne.source, ligne.episode_id, ligne.step], [1, 'brain', 'ep-1', 3])
})

test('POST /execute : nom inconnu = résultat unknown_skill (pas une erreur HTTP)', async () => {
    const r = await poster(await api(fakeBot()), { name: 'voler' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual((await r.json()).reason, 'unknown_skill')
})

test('POST /execute : requêtes mal formées -> 400', async () => {
    const base = await api(fakeBot())
    for (const corps of ['pas du json', '[]', { args: {} }, { name: 'find', args: [] }, { name: 'find', step: 1.5 }]) {
        const r = await poster(base, corps)
        assert.strictEqual(r.status, 400, JSON.stringify(corps))
    }
})

test('POST /execute : une seule compétence à la fois -> 409 busy', async () => {
    const bot = fakeBot()
    bot.pathfinder.goto = () => new Promise((r) => setTimeout(r, 300)) // un déplacement qui dure
    const base = await api(bot)
    const [a, b] = await Promise.all([
        poster(base, { name: 'move_to', args: { x: 0, y: 100, z: 0 } }),
        new Promise((r) => setTimeout(r, 50)).then(() => poster(base, { name: 'scan' })),
    ])
    assert.deepStrictEqual([a.status, b.status], [200, 409])
})

test('routes inconnues -> 404, mauvaise méthode -> 405', async () => {
    const base = await api(fakeBot())
    assert.strictEqual((await fetch(`${base}/truc`)).status, 404)
    assert.strictEqual((await fetch(`${base}/execute`)).status, 405)
})
