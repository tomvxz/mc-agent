// The body's HTTP API: this is how the brain (Python) talks to the bot.
// The body decides nothing: it reports its state, describes its skills and runs what it is asked to.
//   GET  /state    -> observe(bot)
//   GET  /skills   -> the skill catalogue (src/skills/catalogue.js)
//   POST /execute  -> { name, args, source, episode_id, step }: runs ONE skill (logged)
// Uses Node's built-in http module: no dependency.

const http = require('http')
const execute = require('./execute')
const { observe } = require('./state')
const { CATALOGUE, CATALOGUE_VERSION, COMMON_REASONS } = require('./skills/catalogue')

const MAX_BODY_SIZE = 100 * 1024 // larger request bodies are rejected

// Send a JSON response
function reply(res, code, data) {
    const text = JSON.stringify(data)
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
    res.end(text)
}

// Read the request body and parse it as JSON (or throw)
function readJson(req) {
    return new Promise((resolve, reject) => {
        let text = ''
        req.on('data', (chunk) => {
            text += chunk
            if (text.length > MAX_BODY_SIZE) reject(new Error('request too large'))
        })
        req.on('end', () => {
            try {
                resolve(text ? JSON.parse(text) : {})
            } catch (e) {
                reject(new Error('invalid JSON'))
            }
        })
        req.on('error', reject)
    })
}

// Check an execute request; returns an error message, or null if everything is fine
function validateRequest(d) {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return 'the body must be a JSON object'
    if (typeof d.name !== 'string') return 'name must be a string'
    if (d.args !== undefined && (typeof d.args !== 'object' || d.args === null || Array.isArray(d.args))) return 'args must be an object'
    if (d.source !== undefined && typeof d.source !== 'string') return 'source must be a string'
    if (d.episode_id !== undefined && typeof d.episode_id !== 'string') return 'episode_id must be a string'
    if (d.step !== undefined && !Number.isInteger(d.step)) return 'step must be an integer'
    return null
}

function startApi(bot, { port = 3000, host = '127.0.0.1' } = {}) {
    // One skill at a time: the bot only has one body
    let busy = false

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'GET' && req.url === '/state') {
                let state
                try {
                    state = observe(bot)
                } catch (e) {
                    return reply(res, 503, { error: 'bot_unavailable', message: e.message }) // dead or disconnected
                }
                return reply(res, 200, state)
            }

            if (req.method === 'GET' && req.url === '/skills') {
                return reply(res, 200, { catalogue_version: CATALOGUE_VERSION, common_reasons: COMMON_REASONS, skills: CATALOGUE })
            }

            if (req.method === 'POST' && req.url === '/execute') {
                let request
                try {
                    request = await readJson(req)
                } catch (e) {
                    return reply(res, 400, { error: 'invalid_request', message: e.message })
                }
                const problem = validateRequest(request)
                if (problem) return reply(res, 400, { error: 'invalid_request', message: problem })
                if (busy) return reply(res, 409, { error: 'busy', message: 'a skill is already running' })

                busy = true
                try {
                    const { name, args = {}, source = 'api', episode_id, step } = request
                    // An unknown name is not an HTTP error: execute returns (and logs) unknown_skill
                    const result = await execute(bot, name, args, source, { episode_id, step })
                    return reply(res, 200, result)
                } finally {
                    busy = false
                }
            }

            const routeExists = ['/state', '/skills', '/execute'].includes(req.url)
            return reply(res, routeExists ? 405 : 404, { error: routeExists ? 'method_not_allowed' : 'not_found' })
        } catch (e) {
            // Nothing may bring the server down
            console.error('[api] error:', e)
            if (!res.headersSent) reply(res, 500, { error: 'internal_error', message: e.message })
        }
    })

    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => resolve(server))
    })
}

module.exports = { startApi }
