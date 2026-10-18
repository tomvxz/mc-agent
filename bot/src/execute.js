const runSkill = require('./runSkill')
const skills = require('./skills')
const { observe } = require('./state')
const { logTransition } = require('./logger')

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Si le bot est mort ou déconnecté, observe() plante : on note null au lieu de perdre la transition
function observeSur(bot) {
    try {
        return observe(bot)
    } catch (e) {
        return null
    }
}

// Version du format des lignes du journal : à augmenter si on change leur forme (voir CLAUDE.md)
const SCHEMA_VERSION = 1

// meta (facultatif) : { episode_id, step } quand l'appel vient du cerveau, pour relier plan et résultats
async function execute(bot, name, args = {}, source = 'manual', meta = {}) {
    const avant = observeSur(bot)

    let result
    let apres
    if (Object.hasOwn(skills, name)) {
        result = await runSkill(bot, skills[name], args)
        await attendre(300) // laisse l'inventaire se mettre à jour
        apres = observeSur(bot)
    } else {
        // Nom inconnu : on ne lance rien, mais l'échec est quand même journalisé
        result = { success: false, reason: 'unknown_skill', details: {}, duration: 0 }
        apres = avant
    }

    // Écrire dans le journal ne doit jamais faire planter le bot
    try {
        logTransition({
            schema_version: SCHEMA_VERSION,
            ts: new Date().toISOString(),
            source,
            // Champs optionnels : absents des lignes qui ne viennent pas d'un épisode
            ...(meta.episode_id !== undefined && { episode_id: meta.episode_id }),
            ...(meta.step !== undefined && { step: meta.step }),
            state: avant,
            skill: { name, args },
            next_state: apres,
            success: result.success,
            reason: result.reason,
            duration: result.duration,
        })
    } catch (e) {
        console.error('[journal] écriture impossible :', e.message)
    }
    return result
}

module.exports = execute