// Correctifs de bugs de Mineflayer, appliqués une fois dans bot.js.
// On ne modifie pas node_modules (versions figées) : on corrige depuis notre code.

// Bug (Mineflayer 4.39, serveur 1.21.11) : chaque fenêtre (inventaire = 0, table de craft = 1, 2...)
// a son propre compteur "stateId", mais Mineflayer n'en garde qu'un seul pour toutes. Quand le
// serveur met à jour l'inventaire pendant qu'une table est ouverte, les clics partent avec le
// compteur de l'inventaire ; le serveur renvoie alors toute la fenêtre, Mineflayer se recale sur
// un état en retard et fait de mauvais clics : environ 1 craft sur 2 avec table échouait.
// Correctif : on retient le dernier stateId de CHAQUE fenêtre et on le remet dans les clics.
function corrigerStateId(bot) {
    const etats = {} // { numéro de fenêtre: dernier stateId reçu }
    const retenir = (paquet) => { etats[paquet.windowId] = paquet.stateId }
    bot._client.on('window_items', retenir)
    bot._client.on('set_slot', retenir)

    const ecrire = bot._client.write.bind(bot._client)
    bot._client.write = (nom, paquet) => {
        // stateId -1 = "renvoie-moi tout", Mineflayer l'utilise exprès : on n'y touche pas
        if (nom === 'window_click' && paquet.stateId !== -1 && etats[paquet.windowId] !== undefined) {
            paquet = { ...paquet, stateId: etats[paquet.windowId] }
        }
        return ecrire(nom, paquet)
    }
}

module.exports = { corrigerStateId }
