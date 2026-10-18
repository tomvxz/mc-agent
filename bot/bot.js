const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'Agent',
  version: process.env.MC_VERSION, // fixe explicitement, ne laisse pas deviner
})

bot.loadPlugin(pathfinder)

// Diagnostic : ces événements te disent pourquoi une connexion échoue
bot.on('error', (err) => console.error('[erreur]', err.message))
bot.on('kicked', (reason) => console.error('[expulsé]', reason))
bot.on('end', (reason) => console.log('[déconnecté]', reason))

bot.once('spawn', async () => {
  console.log('[spawn] version du jeu :', bot.version)

  // Lecture de l'état
  const p = bot.entity.position
  console.log('Position :', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1))
  console.log('Santé :', bot.health, '| Faim :', bot.food)
  console.log('Inventaire :', bot.inventory.items().map((i) => `${i.name} x${i.count}`))

  // Déplacement : aller 10 blocs plus loin
  bot.pathfinder.setMovements(new Movements(bot))
  try {
    await bot.pathfinder.goto(new goals.GoalNear(p.x + 10, p.y, p.z, 1))
    console.log('Arrivé :', bot.entity.position.toString())
  } catch (e) {
    console.error('[déplacement échoué]', e.message)
  }
})