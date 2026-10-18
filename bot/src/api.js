// L'API HTTP du corps : c'est par là que le cerveau (Python) parle au bot.
// Le corps ne décide rien : il donne l'état, décrit ses compétences et exécute ce qu'on lui demande.
//   GET  /state    -> observe(bot)
//   GET  /skills   -> le catalogue des compétences (src/skills/catalogue.js)
//   POST /execute  -> { name, args, source, episode_id, step } : exécute UNE compétence (journalisée)
// Utilise le module http inclus dans Node : aucune dépendance.

const http = require('http')
const execute = require('./execute')
const { observe } = require('./state')
const { CATALOGUE, CATALOGUE_VERSION, RAISONS_COMMUNES } = require('./skills/catalogue')

const TAILLE_MAX = 100 * 1024 // un corps de requête plus gros est refusé

// Envoie une réponse JSON
function repondre(res, code, donnees) {
    const texte = JSON.stringify(donnees)
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(texte) })
    res.end(texte)
}

// Lit le corps de la requête et le transforme en objet (ou lève une erreur)
function lireJson(req) {
    return new Promise((resolve, reject) => {
        let texte = ''
        req.on('data', (morceau) => {
            texte += morceau
            if (texte.length > TAILLE_MAX) reject(new Error('requête trop grosse'))
        })
        req.on('end', () => {
            try {
                resolve(texte ? JSON.parse(texte) : {})
            } catch (e) {
                reject(new Error('JSON invalide'))
            }
        })
        req.on('error', reject)
    })
}

// Vérifie une demande d'exécution ; renvoie un message d'erreur, ou null si tout va bien
function verifierDemande(d) {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return 'le corps doit être un objet JSON'
    if (typeof d.name !== 'string') return 'name doit être un texte'
    if (d.args !== undefined && (typeof d.args !== 'object' || d.args === null || Array.isArray(d.args))) return 'args doit être un objet'
    if (d.source !== undefined && typeof d.source !== 'string') return 'source doit être un texte'
    if (d.episode_id !== undefined && typeof d.episode_id !== 'string') return 'episode_id doit être un texte'
    if (d.step !== undefined && !Number.isInteger(d.step)) return 'step doit être un entier'
    return null
}

function demarrerApi(bot, { port = 3000, host = '127.0.0.1' } = {}) {
    // Une seule compétence à la fois : le bot n'a qu'un corps
    let occupe = false

    const serveur = http.createServer(async (req, res) => {
        try {
            if (req.method === 'GET' && req.url === '/state') {
                let etat
                try {
                    etat = observe(bot)
                } catch (e) {
                    return repondre(res, 503, { error: 'bot_unavailable', message: e.message }) // mort ou déconnecté
                }
                return repondre(res, 200, etat)
            }

            if (req.method === 'GET' && req.url === '/skills') {
                return repondre(res, 200, { catalogue_version: CATALOGUE_VERSION, common_reasons: RAISONS_COMMUNES, skills: CATALOGUE })
            }

            if (req.method === 'POST' && req.url === '/execute') {
                let demande
                try {
                    demande = await lireJson(req)
                } catch (e) {
                    return repondre(res, 400, { error: 'invalid_request', message: e.message })
                }
                const probleme = verifierDemande(demande)
                if (probleme) return repondre(res, 400, { error: 'invalid_request', message: probleme })
                if (occupe) return repondre(res, 409, { error: 'busy', message: 'une compétence est déjà en cours' })

                occupe = true
                try {
                    const { name, args = {}, source = 'api', episode_id, step } = demande
                    // Un nom inconnu n'est pas une erreur HTTP : execute renvoie (et journalise) unknown_skill
                    const resultat = await execute(bot, name, args, source, { episode_id, step })
                    return repondre(res, 200, resultat)
                } finally {
                    occupe = false
                }
            }

            const routeExiste = ['/state', '/skills', '/execute'].includes(req.url)
            return repondre(res, routeExiste ? 405 : 404, { error: routeExiste ? 'method_not_allowed' : 'not_found' })
        } catch (e) {
            // Rien ne doit faire tomber le serveur
            console.error('[api] erreur :', e)
            if (!res.headersSent) repondre(res, 500, { error: 'internal_error', message: e.message })
        }
    })

    return new Promise((resolve, reject) => {
        serveur.once('error', reject)
        serveur.listen(port, host, () => resolve(serveur))
    })
}

module.exports = { demarrerApi }
