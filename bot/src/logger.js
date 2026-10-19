const fs = require('fs')
const path = require('path')

const DEFAULT_FILE = path.resolve(__dirname, '../../data/transitions.jsonl')

function logTransition(entry) {
    // TRANSITIONS_FILE lets offline tests write somewhere other than the real journal
    const file = process.env.TRANSITIONS_FILE || DEFAULT_FILE
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
}

module.exports = { logTransition }
