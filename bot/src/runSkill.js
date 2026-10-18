async function runSkill(bot, skill, args, timeoutMs = 60000) {
    const debut = Date.now()
    let minuteur

    // Une promesse qui échoue au bout de timeoutMs
    const delai = new Promise((_, reject) => {
        minuteur = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })

    let resultat
    try {
        // La première des deux qui finit gagne : la compétence ou le délai
        resultat = await Promise.race([skill(bot, args), delai])
    } catch (e) {
        resultat = {
            success: false,
            reason: e.message === 'timeout' ? 'timeout' : 'exception',
            details: { error: e.message },
        }
        // setGoal(null) arrête tout de suite ; stop() attendait le prochain bloc
        // et faisait échouer la compétence suivante (no_path immédiat)
        bot.pathfinder.setGoal(null)
        bot.stopDigging()
    } finally {
        clearTimeout(minuteur)
    }

    // Une compétence qui ne renvoie pas { success, reason } est un bug
    if (!resultat || typeof resultat.success !== 'boolean') {
        resultat = { success: false, reason: 'bad_result', details: { value: resultat } }
    }

    return { ...resultat, duration: (Date.now() - debut) / 1000 }
}

module.exports = runSkill