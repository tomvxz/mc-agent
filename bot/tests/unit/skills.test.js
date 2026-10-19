// The failure cases of each skill that are decided BEFORE acting in the game.
// Cases that need the real game live in tests/game/.
const test = require('node:test')
const assert = require('node:assert')
const skills = require('../../src/skills')
const { fakeBot, Point } = require('./fakeBot')

// Check success + reason
async function expectResult(promise, success, reason) {
    const r = await promise
    assert.deepStrictEqual([r.success, r.reason], [success, reason], JSON.stringify(r))
    assert.ok(r.details && typeof r.details === 'object', 'details must be an object')
    return r
}

test('the catalogue holds exactly the 9 skills of batch 1', () => {
    assert.deepStrictEqual(Object.keys(skills).sort(),
        ['break_block', 'craft', 'eat', 'explore', 'find', 'mine', 'move_to', 'place_block', 'scan'])
})

test('move_to: invalid coordinates', async () => {
    await expectResult(skills.move_to(fakeBot(), {}), false, 'invalid_args')
    await expectResult(skills.move_to(fakeBot(), { x: '1', y: 2, z: 3 }), false, 'invalid_args')
    await expectResult(skills.move_to(fakeBot(), { x: 1, y: 2, z: 3, range: -1 }), false, 'invalid_args')
})

test('move_to: pathfinder errors are translated into reasons', async () => {
    const cases = { NoPath: 'no_path', Timeout: 'path_timeout', GoalChanged: 'interrupted', PathStopped: 'interrupted' }
    for (const [name, reason] of Object.entries(cases)) {
        const bot = fakeBot()
        bot.pathfinder.goto = async () => { const e = new Error(name); e.name = name; throw e }
        await expectResult(skills.move_to(bot, { x: 10, y: 100, z: 0 }), false, reason)
    }
})

test('move_to: the pathfinder says "arrived" but the bot is far -> not_arrived', async () => {
    const r = await expectResult(skills.move_to(fakeBot(), { x: 50, y: 100, z: 0 }), false, 'not_arrived')
    assert.deepStrictEqual([r.details.blocks_placed, r.details.blocks_broken], [0, 0])
})

test('break_block: arguments, nothing to break, unbreakable, missing tool', async () => {
    await expectResult(skills.break_block(fakeBot(), { x: 1.5, y: 100, z: 0 }), false, 'invalid_args')
    await expectResult(skills.break_block(fakeBot(), { x: 1, y: 100, z: 0 }), false, 'nothing_to_break')
    const water = fakeBot({ blocks: { '1,100,0': 'water' } })
    await expectResult(skills.break_block(water, { x: 1, y: 100, z: 0 }), false, 'nothing_to_break')
    const barrier = fakeBot({ blocks: { '1,100,0': 'barrier' } })
    await expectResult(skills.break_block(barrier, { x: 1, y: 100, z: 0 }), false, 'unbreakable')
    const stone = fakeBot({ blocks: { '1,100,0': 'stone' } })
    const r = await expectResult(skills.break_block(stone, { x: 1, y: 100, z: 0 }), false, 'no_tool')
    assert.ok(r.details.tools.includes('wooden_pickaxe'))
})

test('place_block: arguments, inventory, occupied cell, no support', async () => {
    await expectResult(skills.place_block(fakeBot(), { item: 'stone', x: 1.5, y: 100, z: 0 }), false, 'invalid_args')
    // The old argument name "block" is no longer accepted
    await expectResult(skills.place_block(fakeBot(), { block: 'stone', x: 1, y: 100, z: 0 }), false, 'invalid_args')
    await expectResult(skills.place_block(fakeBot(), { item: 'no_such_block', x: 1, y: 100, z: 0 }), false, 'unknown_block')
    await expectResult(skills.place_block(fakeBot(), { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'not_in_inventory')
    const occupied = fakeBot({ inventory: { cobblestone: 5 }, blocks: { '1,100,0': 'stone' } })
    await expectResult(skills.place_block(occupied, { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'occupied')
    const midAir = fakeBot({ inventory: { cobblestone: 5 } }) // only air around
    await expectResult(skills.place_block(midAir, { item: 'cobblestone', x: 1, y: 100, z: 0 }), false, 'no_support')
})

test('craft: arguments, unknown item, no recipe, ingredients, table', async () => {
    await expectResult(skills.craft(fakeBot(), { item: 'stick', count: 0 }), false, 'invalid_args')
    await expectResult(skills.craft(fakeBot(), { item: 'no_such_item' }), false, 'unknown_item')
    await expectResult(skills.craft(fakeBot(), { item: 'dirt' }), false, 'no_recipe') // empty recipesAll

    const noIngredients = fakeBot()
    noIngredients.recipesAll = () => [{}]
    await expectResult(skills.craft(noIngredients, { item: 'stick' }), false, 'missing_ingredients')

    // Ingredients OK only with a table (3x3), but no table around
    const noTable = fakeBot()
    noTable.recipesAll = () => [{}]
    noTable.recipesFor = (id, meta, n, table) => (table ? [{ result: { count: 1 } }] : [])
    await expectResult(skills.craft(noTable, { item: 'wooden_pickaxe' }), false, 'no_crafting_table')
})

test('eat: unknown food, not hungry, nothing to eat', async () => {
    await expectResult(skills.eat(fakeBot({ food: 10 }), { food: 'diamond' }), false, 'unknown_item')
    await expectResult(skills.eat(fakeBot({ food: 10 }), { food: 3 }), false, 'invalid_args')
    await expectResult(skills.eat(fakeBot({ food: 20, inventory: { bread: 3 } })), false, 'not_hungry')
    await expectResult(skills.eat(fakeBot({ food: 10, inventory: { dirt: 3 } })), false, 'no_food')
    // Rotten flesh is never picked automatically
    await expectResult(skills.eat(fakeBot({ food: 10, inventory: { rotten_flesh: 3 } })), false, 'no_food')
})

test('find: arguments, unknown target, nothing found', async () => {
    await expectResult(skills.find(fakeBot(), {}), false, 'invalid_args')
    await expectResult(skills.find(fakeBot(), { target: 'oak_log', max_distance: 500 }), false, 'invalid_args')
    await expectResult(skills.find(fakeBot(), { target: 'no_such_thing' }), false, 'unknown_target')
    await expectResult(skills.find(fakeBot(), { target: 'oak_log' }), false, 'not_found')
})

test('find: blocks sorted nearest first, limited to count', async () => {
    const bot = fakeBot({ blocks: { '20,100,0': 'oak_log', '3,100,0': 'oak_log', '10,100,0': 'oak_log', '5,100,0': 'stone' } })
    const r = await expectResult(skills.find(bot, { target: 'oak_log', count: 2 }), true, 'ok')
    assert.deepStrictEqual(r.details.matches.map((m) => m.x), [3, 10])
})

test('find: "hostile" finds a slime (type mob) but not a pig', async () => {
    const entities = {
        1: { type: 'animal', name: 'pig', position: new Point(2, 100, 0) },
        2: { type: 'mob', name: 'slime', position: new Point(6, 100, 0) },
    }
    const r = await expectResult(skills.find(fakeBot({ entities }), { target: 'hostile' }), true, 'ok')
    assert.deepStrictEqual(r.details.matches.map((m) => m.name), ['slime'])
    const pig = await expectResult(skills.find(fakeBot({ entities }), { target: 'pig' }), true, 'ok')
    assert.strictEqual(pig.details.matches[0].distance, 1.6) // from (0.5, 0.5) to (2, 0)
})

test('scan: arguments and shape of the result', async () => {
    await expectResult(skills.scan(fakeBot(), { radius: 100 }), false, 'invalid_args')
    const bot = fakeBot({
        blocks: { '3,100,0': 'oak_log', '4,100,0': 'oak_log', '2,99,0': 'iron_ore', '1,99,0': 'dirt' },
        entities: { 1: { type: 'hostile', name: 'zombie', position: new Point(5, 100, 0) } },
    })
    const r = await expectResult(skills.scan(bot), true, 'ok')
    assert.deepStrictEqual(r.details.blocks.oak_log, { count: 2, nearest: [3, 100, 0] })
    assert.strictEqual(r.details.blocks.iron_ore.count, 1)
    assert.strictEqual(r.details.blocks.dirt, undefined) // dirt is not a "useful" block
    assert.strictEqual(r.details.entities.zombie.count, 1)
})

test('explore: invalid direction and distance', async () => {
    await expectResult(skills.explore(fakeBot(), { direction: 'up' }), false, 'invalid_args')
    await expectResult(skills.explore(fakeBot(), { direction: 'north', distance: 0 }), false, 'invalid_args')
})

test('mine: unknown block, invalid count, block absent', async () => {
    await expectResult(skills.mine(fakeBot(), { block: 'no_such_block' }), false, 'unknown_block')
    for (const count of [0, -1, '2', 1.5, null]) {
        await expectResult(skills.mine(fakeBot(), { block: 'oak_log', count }), false, 'invalid_args')
    }
    await expectResult(skills.mine(fakeBot(), { block: 'oak_log' }), false, 'block_not_found')
})

test('mine: stone without a pickaxe -> no_tool (bubbles up from break_block)', async () => {
    const bot = fakeBot({ blocks: { '3,100,0': 'stone' } })
    await expectResult(skills.mine(bot, { block: 'stone' }), false, 'no_tool')
})
