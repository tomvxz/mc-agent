// Les cas d'échec de chaque compétence qui se décident AVANT d'agir dans le jeu.
// Les cas qui demandent le vrai jeu sont dans tests/game/.
const test = require('node:test')
const assert = require('node:assert')
const skills = require('../../src/skills')
const { fakeBot, Point } = require('./fakeBot')

// Vérifie success + reason
async function attendu(promesse, success, reason) {
    const r = await promesse
    assert.deepStrictEqual([r.success, r.reason], [success, reason], JSON.stringify(r))
    assert.ok(r.details && typeof r.details === 'object', 'details doit être un objet')
    return r
}

test('le catalogue contient exactement les 9 compétences du lot 1', () => {
    assert.deepStrictEqual(Object.keys(skills).sort(),
        ['break_block', 'craft', 'eat', 'explore', 'find', 'mine', 'move_to', 'place_block', 'scan'])
})

test('move_to : coordonnées invalides', async () => {
    await attendu(skills.move_to(fakeBot(), {}), false, 'invalid_args')
    await attendu(skills.move_to(fakeBot(), { x: '1', y: 2, z: 3 }), false, 'invalid_args')
    await attendu(skills.move_to(fakeBot(), { x: 1, y: 2, z: 3, range: -1 }), false, 'invalid_args')
})

test('move_to : erreurs du pathfinder traduites en raisons', async () => {
    const cas = { NoPath: 'no_path', Timeout: 'path_timeout', GoalChanged: 'interrupted', PathStopped: 'interrupted' }
    for (const [nom, raison] of Object.entries(cas)) {
        const bot = fakeBot()
        bot.pathfinder.goto = async () => { const e = new Error(nom); e.name = nom; throw e }
        await attendu(skills.move_to(bot, { x: 10, y: 100, z: 0 }), false, raison)
    }
})

test('move_to : le pathfinder dit "arrivé" mais le bot est loin -> not_arrived', async () => {
    const r = await attendu(skills.move_to(fakeBot(), { x: 50, y: 100, z: 0 }), false, 'not_arrived')
    assert.deepStrictEqual([r.details.blocks_placed, r.details.blocks_broken], [0, 0])
})

test('break_block : arguments, rien à casser, incassable, outil manquant', async () => {
    await attendu(skills.break_block(fakeBot(), { x: 1.5, y: 100, z: 0 }), false, 'invalid_args')
    await attendu(skills.break_block(fakeBot(), { x: 1, y: 100, z: 0 }), false, 'nothing_to_break')
    const eau = fakeBot({ blocks: { '1,100,0': 'water' } })
    await attendu(skills.break_block(eau, { x: 1, y: 100, z: 0 }), false, 'nothing_to_break')
    const barriere = fakeBot({ blocks: { '1,100,0': 'barrier' } })
    await attendu(skills.break_block(barriere, { x: 1, y: 100, z: 0 }), false, 'unbreakable')
    const pierre = fakeBot({ blocks: { '1,100,0': 'stone' } })
    const r = await attendu(skills.break_block(pierre, { x: 1, y: 100, z: 0 }), false, 'no_tool')
    assert.ok(r.details.tools.includes('wooden_pickaxe'))
})

test('place_block : arguments, inventaire, case occupée, aucun appui', async () => {
    await attendu(skills.place_block(fakeBot(), { item: 'stone', x: 1.5, y: 100, z: 0 }), false, 'invalid_args')
    // L'ancien nom d'argument "block" n'est plus accepté
    await attendu(skills.place_block(fakeBot(), { block: 'stone', x: 1, y: 100, z: 0 }), false, 'invalid_args')
    await attendu(skills.place_block(fakeBot(), { item: 'truc', x: 1, y: 100, z: 0 }), false, 'unknown_block')
    await attendu(skills.place_block(fakeBot(), { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'not_in_inventory')
    const occupe = fakeBot({ inventory: { cobblestone: 5 }, blocks: { '1,100,0': 'stone' } })
    await attendu(skills.place_block(occupe, { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'occupied')
    const enLAir = fakeBot({ inventory: { cobblestone: 5 } }) // tout est de l'air autour
    await attendu(skills.place_block(enLAir, { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'no_support')
})

test('craft : arguments, objet inconnu, sans recette, ingrédients, table', async () => {
    await attendu(skills.craft(fakeBot(), { item: 'stick', count: 0 }), false, 'invalid_args')
    await attendu(skills.craft(fakeBot(), { item: 'truc' }), false, 'unknown_item')
    await attendu(skills.craft(fakeBot(), { item: 'dirt' }), false, 'no_recipe') // recipesAll vide

    const sansIngredients = fakeBot()
    sansIngredients.recipesAll = () => [{}]
    await attendu(skills.craft(sansIngredients, { item: 'stick' }), false, 'missing_ingredients')

    // Ingrédients OK seulement avec une table (3x3), mais aucune table autour
    const sansTable = fakeBot()
    sansTable.recipesAll = () => [{}]
    sansTable.recipesFor = (id, meta, n, table) => (table ? [{ result: { count: 1 } }] : [])
    await attendu(skills.craft(sansTable, { item: 'wooden_pickaxe' }), false, 'no_crafting_table')
})

test('eat : aliment inconnu, pas faim, rien à manger', async () => {
    await attendu(skills.eat(fakeBot({ food: 10 }), { food: 'diamond' }), false, 'unknown_item')
    await attendu(skills.eat(fakeBot({ food: 10 }), { food: 3 }), false, 'invalid_args')
    await attendu(skills.eat(fakeBot({ food: 20, inventory: { bread: 3 } })), false, 'not_hungry')
    await attendu(skills.eat(fakeBot({ food: 10, inventory: { dirt: 3 } })), false, 'no_food')
    // De la chair putréfiée n'est jamais choisie toute seule
    await attendu(skills.eat(fakeBot({ food: 10, inventory: { rotten_flesh: 3 } })), false, 'no_food')
})

test('find : arguments, cible inconnue, rien trouvé', async () => {
    await attendu(skills.find(fakeBot(), {}), false, 'invalid_args')
    await attendu(skills.find(fakeBot(), { target: 'oak_log', max_distance: 500 }), false, 'invalid_args')
    await attendu(skills.find(fakeBot(), { target: 'truc' }), false, 'unknown_target')
    await attendu(skills.find(fakeBot(), { target: 'oak_log' }), false, 'not_found')
})

test('find : blocs triés du plus proche au plus loin, limités à count', async () => {
    const bot = fakeBot({ blocks: { '20,100,0': 'oak_log', '3,100,0': 'oak_log', '10,100,0': 'oak_log', '5,100,0': 'stone' } })
    const r = await attendu(skills.find(bot, { target: 'oak_log', count: 2 }), true, 'ok')
    assert.deepStrictEqual(r.details.matches.map((m) => m.x), [3, 10])
})

test('find : "hostile" trouve un slime (type mob) mais pas un cochon', async () => {
    const entities = {
        1: { type: 'animal', name: 'pig', position: new Point(2, 100, 0) },
        2: { type: 'mob', name: 'slime', position: new Point(6, 100, 0) },
    }
    const r = await attendu(skills.find(fakeBot({ entities }), { target: 'hostile' }), true, 'ok')
    assert.deepStrictEqual(r.details.matches.map((m) => m.name), ['slime'])
    const cochon = await attendu(skills.find(fakeBot({ entities }), { target: 'pig' }), true, 'ok')
    assert.strictEqual(cochon.details.matches[0].distance, 1.6) // de (0.5, 0.5) à (2, 0)
})

test('scan : arguments et forme du résultat', async () => {
    await attendu(skills.scan(fakeBot(), { radius: 100 }), false, 'invalid_args')
    const bot = fakeBot({
        blocks: { '3,100,0': 'oak_log', '4,100,0': 'oak_log', '2,99,0': 'iron_ore', '1,99,0': 'dirt' },
        entities: { 1: { type: 'hostile', name: 'zombie', position: new Point(5, 100, 0) } },
    })
    const r = await attendu(skills.scan(bot), true, 'ok')
    assert.deepStrictEqual(r.details.blocks.oak_log, { count: 2, nearest: [3, 100, 0] })
    assert.strictEqual(r.details.blocks.iron_ore.count, 1)
    assert.strictEqual(r.details.blocks.dirt, undefined) // la terre n'est pas un bloc "utile"
    assert.strictEqual(r.details.entities.zombie.count, 1)
})

test('explore : direction et distance invalides', async () => {
    await attendu(skills.explore(fakeBot(), { direction: 'haut' }), false, 'invalid_args')
    await attendu(skills.explore(fakeBot(), { direction: 'north', distance: 0 }), false, 'invalid_args')
})

test('mine : bloc inconnu, count invalide, bloc absent', async () => {
    await attendu(skills.mine(fakeBot(), { block: 'truc' }), false, 'unknown_block')
    for (const count of [0, -1, '2', 1.5, null]) {
        await attendu(skills.mine(fakeBot(), { block: 'oak_log', count }), false, 'invalid_args')
    }
    await attendu(skills.mine(fakeBot(), { block: 'oak_log' }), false, 'block_not_found')
})

test('mine : pierre sans pioche -> no_tool (remonte de break_block)', async () => {
    const bot = fakeBot({ blocks: { '3,100,0': 'stone' } })
    await attendu(skills.mine(bot, { block: 'stone' }), false, 'no_tool')
})
