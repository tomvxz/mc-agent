// Lance la suite de tests en jeu d'une compétence (ou de toutes).
// Utilisation : node --env-file=../.env bot.js suite <compétence|all> [nombre d'essais]
//
// - Cas "nominaux" : la compétence doit réussir. On en fait N essais (10 par défaut) et on
//   calcule le taux de réussite (objectif >= 80 %). verify() contrôle le monde réel pour
//   repérer les "faux succès" (la compétence dit ok mais rien n'a changé).
// - Cas "limites" : un essai chacun, la compétence doit renvoyer exactement la raison attendue.
// Tout passe par execute() : chaque essai est journalisé avec la source "test:<compétence>".

const execute = require('../../src/execute')
const { observe } = require('../../src/state')
const { preparer, reinitialiser } = require('./arena')

const SUITES = ['move_to', 'break_block', 'place_block', 'craft', 'eat', 'find', 'scan', 'explore', 'mine']

// Un essai : mise en place, exécution, vérification
async function essai(bot, skill, cas) {
    await reinitialiser(bot)
    try {
        if (cas.setup) await cas.setup(bot)
    } catch (e) {
        return { etat: 'setup_failed', texte: e.message }
    }

    const avant = observe(bot)
    const r = await execute(bot, skill, cas.args, `test:${skill}`)
    const apres = observe(bot)

    let verifie = true
    if (cas.verify && r.success) verifie = await cas.verify(r, avant, apres, bot)
    return { r, verifie }
}

async function lancerSuite(bot, skill, n) {
    const { nominaux, limites } = require(`./${skill}`)
    const bilan = { skill, reussis: 0, essais: 0, fauxSucces: 0, setupRates: 0, limitesOk: 0, limitesTotal: limites.length }
    console.log(`\n=== ${skill} : ${n} essais nominaux, ${limites.length} cas limites ===`)

    for (let i = 0; i < n; i++) {
        const cas = nominaux[i % nominaux.length]
        const res = await essai(bot, skill, cas)
        if (res.etat === 'setup_failed') {
            bilan.setupRates++
            console.log(`  [${i + 1}] ${cas.nom} : MISE EN PLACE RATÉE (${res.texte}), non compté`)
            continue
        }
        bilan.essais++
        const { r, verifie } = res
        let marque = r.success ? 'OK' : 'ÉCHEC'
        if (r.success && verifie !== true) {
            bilan.fauxSucces++
            marque = `FAUX SUCCÈS (${verifie})`
        } else if (r.success) {
            bilan.reussis++
        }
        console.log(`  [${i + 1}] ${cas.nom} : ${marque} ${r.reason} ${r.duration}s ${JSON.stringify(r.details)}`)
    }

    for (const cas of limites) {
        const res = await essai(bot, skill, cas)
        if (res.etat === 'setup_failed') {
            console.log(`  [limite] ${cas.nom} : MISE EN PLACE RATÉE (${res.texte})`)
            continue
        }
        const ok = res.r.reason === cas.expect
        if (ok) bilan.limitesOk++
        console.log(`  [limite] ${cas.nom} : ${ok ? 'OK' : 'INATTENDU'} attendu=${cas.expect} obtenu=${res.r.reason}`)
    }

    const taux = bilan.essais ? Math.round((100 * bilan.reussis) / bilan.essais) : 0
    const valide = taux >= 80 && bilan.fauxSucces === 0 && bilan.limitesOk === bilan.limitesTotal
    console.log(
        `--- ${skill} : ${bilan.reussis}/${bilan.essais} réussis (${taux} %), faux succès : ${bilan.fauxSucces}, ` +
        `limites : ${bilan.limitesOk}/${bilan.limitesTotal}, mises en place ratées : ${bilan.setupRates} -> ${valide ? 'VALIDÉ' : 'NON VALIDÉ'}`
    )
    return { ...bilan, taux, valide }
}

async function run(bot, nom, n) {
    const noms = nom === 'all' ? SUITES : [nom]
    if (!noms.every((s) => SUITES.includes(s))) {
        console.log(`Suite inconnue : ${nom}. Choix : ${SUITES.join(', ')}, all`)
        return
    }
    const essais = parseInt(n || '10', 10)

    await preparer(bot)
    const bilans = []
    for (const s of noms) bilans.push(await lancerSuite(bot, s, essais))

    if (bilans.length > 1) {
        console.log('\n=== Résumé ===')
        for (const b of bilans) console.log(`  ${b.skill} : ${b.taux} % ${b.valide ? 'VALIDÉ' : 'NON VALIDÉ'}`)
    }
}

module.exports = run
