// The skill catalogue. NAMES are stable: they are inputs of the world model.
module.exports = {
    // Primitives (act on the world)
    move_to: require('./move_to'),
    break_block: require('./break_block'),
    place_block: require('./place_block'),
    craft: require('./craft'),
    eat: require('./eat'),
    // Questions (change nothing in the world)
    find: require('./find'),
    scan: require('./scan'),
    // Moving to discover new places
    explore: require('./explore'),
    // Shortcuts (assemblies of primitives)
    mine: require('./mine'),
}
