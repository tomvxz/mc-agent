// Le catalogue des compétences. Les NOMS sont stables : ce sont des entrées du world model.
module.exports = {
    // Primitives (agissent sur le monde)
    move_to: require('./move_to'),
    break_block: require('./break_block'),
    place_block: require('./place_block'),
    craft: require('./craft'),
    eat: require('./eat'),
    // Questions (ne changent rien au monde)
    find: require('./find'),
    scan: require('./scan'),
    // Déplacement pour découvrir
    explore: require('./explore'),
    // Raccourcis (assemblages de primitives)
    mine: require('./mine'),
}
