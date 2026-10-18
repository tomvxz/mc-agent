const fs = require('fs')
const path = require('path')

const FICHIER = path.resolve(__dirname, '../../data/transitions.jsonl')

function logTransition(entree) {
    // TRANSITIONS_FILE permet aux tests hors jeu d'écrire ailleurs que dans le vrai journal
    const fichier = process.env.TRANSITIONS_FILE || FICHIER
    fs.mkdirSync(path.dirname(fichier), { recursive: true })
    fs.appendFileSync(fichier, JSON.stringify(entree) + '\n')
}

module.exports = { logTransition }