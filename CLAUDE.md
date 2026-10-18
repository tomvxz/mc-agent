# mc-agent

Agent Minecraft qui raisonne et parle (LLM), et anticipe les conséquences de ses actions (world model),
branché sur le VRAI jeu via Mineflayer. Projet d'apprentissage : l'utilisateur débute en JavaScript.

## Architecture
- `server/` : serveur Paper 1.21.11 local (online-mode=false). Le bot est op.
- `bot/` : Node.js, Mineflayer + mineflayer-pathfinder, CommonJS (`require`, pas d'ESM).
  - `bot.js` : crée le bot, lance les tests (`node --env-file=../.env bot.js testN`, ou `suite <compétence|all> [N]`)
  - `src/skills/` : une compétence par fichier, regroupées dans `index.js` (`outils.js` = fonctions partagées)
  - `src/movements.js` : réglages du pathfinder (déplacements débrouillards + instincts), `src/correctifs.js` : correctifs de bugs Mineflayer
  - `tests/unit/` (`npm test`, faux bot, sans serveur) et `tests/game/` (arène reproductible, taux de réussite)
  - `src/runSkill.js` : enveloppe (timeout, capture d'erreurs, durée)
  - `src/state.js` : `observe(bot)` renvoie l'état structuré (pas de pixels)
  - `src/logger.js`, `src/execute.js` : exécute une compétence et journalise la transition
- `data/transitions.jsonl` : une ligne par compétence {state, skill, next_state, success, reason, duration}. Ignoré par git.
- `brain/` (Python géré par uv) : agent LLM, puis world model supervisé (PyTorch).
- Communication corps/cerveau : Node (le corps) expose une petite API HTTP locale ; Python (le cerveau) l'appelle.
  Node ne contient aucune logique de décision ; Python ne parle jamais directement à Minecraft.

## Conventions à respecter
- Une compétence est `async function nom(bot, args)` et renvoie TOUJOURS `{ success, reason, details }`
  (`runSkill` ajoute `duration`). Les échecs sont rapportés honnêtement, jamais masqués.
- Chaque compétence a un timeout dur (via `runSkill`). Aucune exception ne doit s'échapper.
- Toujours appeler `execute(bot, name, args, source)`, jamais `runSkill` seul, pour que tout soit journalisé.
- La version de Minecraft vit uniquement dans `.env` (MC_VERSION). Ne jamais l'écrire en dur.
- Ne pas mettre à jour les dépendances (pas de `npm audit fix`, `npm update`) : versions figées par package-lock.json.
- Le bot est créé une seule fois dans `bot.js` et passé en argument ; les modules ne créent pas de bot.
- Le journal est la matière première du world model : ne jamais le modifier à la main ni filtrer les échecs.
- Garder l'état de `observe` simple ; tout champ ajouté doit rester optionnel pour les anciennes lignes.

## Philosophie des compétences (décision de conception)
- Le LLM COMPOSE : il enchaîne des compétences pour atteindre un but. Ne pas écrire une compétence par objectif.
- Deux niveaux :
  - Primitives générales et indépendantes, paramétrées par coordonnées ou cible :
    `move_to(x,y,z)`, `break_block(x,y,z)`, `place_block(item,x,y,z)`, `use_item(item,cible)`,
    `attack(entité)`, `container(position,action,item,quantité)`, `craft`, `smelt`, `equip`, `eat`, `wait`.
  - Raccourcis (macros) pour l'efficacité : `mine(block,count)` (fait). `flee` = `find(hostile)` + `move_to` : pas de raccourci pour l'instant.
    Un raccourci est un assemblage de primitives (ex. mine = find + move_to + break_block), pas un code à part.
- Compétences "questions" (sans effet sur le monde) : `find(bloc|entité)` et `scan`, pour que le LLM sache où sont les ressources.
- Toujours avoir `explore(direction, distance)` : sinon `block_not_found` bloque le LLM.
- Préférer peu de compétences génériques à beaucoup de spécifiques. Départ : 8 à 10, plafond visé : 20 à 30.
- Noms et signatures STABLES : les compétences sont des entrées du world model, renommer casse les anciennes données.
- Ne pas écrire de primitive trop restrictive (ex. `place` "à côté du bot") : utiliser des coordonnées dès le départ.
- Chaque compétence vérifie ses prérequis et renvoie une raison explicite
  (`missing_ingredients`, `no_tool`, `block_not_found`, `no_path`, `timeout`...) que le LLM peut exploiter.
- Contrôle d'expressivité : une liste de tâches variées (abri 3x3, planter du blé, tuer et cuire une vache,
  ranger dans un coffre, traverser un ravin) doit pouvoir s'écrire comme suite de primitives.
  Une tâche inexprimable = il manque une primitive.

## LLM et boucle de décision
- L'outil `propose_plans` du LLM contient un champ optionnel `missing_capability` (ce dont il aurait eu besoin).
  Le journaliser ; ajouter des primitives selon la fréquence de ces demandes, pas par intuition.
- Renvoyer au LLM les résultats structurés `{success, reason, details}` pour qu'il corrige son plan.
- Chaque compétence est décrite en langage clair dans le prompt (quand l'utiliser, paramètres, limites).
- Plus tard (après l'étape 8) : le LLM pourra ENREGISTRER un plan réussi comme nouveau raccourci, sous forme
  de DONNÉES (liste d'appels de primitives avec paramètres), jamais du code arbitraire exécuté.
  Si des boucles ou conditions sont nécessaires, concevoir un mini-langage simple.
- Voyager (Wang et al. 2023) est une inspiration et une baseline, pas à reproduire : il fait écrire du code au LLM
  et n'a pas de modèle appris. Notre différence : primitives écrites à la main + world model entraîné
  (prédiction avant l'action, détection de surprise après).

## Journal : un format solide (matière première du world model et du futur espace latent)
- Deux fichiers JSONL, une ligne = un événement, jamais réécrits :
  - `data/transitions.jsonl` (écrit par Node) : une ligne par compétence exécutée.
  - `data/episodes.jsonl` (écrit par Python) : but, prompt, réponse brute du LLM, plan, `missing_capability`, résultat final.
- Chaque ligne porte un `schema_version` ; changer le format = nouvelle version, pas de réécriture des anciennes lignes.
- Les transitions d'un épisode LLM portent l'`episode_id` et le numéro d'étape, pour relier plan et résultats.
- Garder la réponse brute du LLM (pas seulement le plan interprété) : elle servira à entraîner le lien LLM <-> world model.
- Noter dans chaque épisode le modèle utilisé (nom, version) et la version du catalogue de compétences.

## World model
- Supervisé (pas du RL) : (état, compétence) -> succès, durée, danger, delta d'inventaire. Ensemble de MLP, l'incertitude vient du désaccord.
- Toujours comparer à des baselines triviales (taux de base, médiane) et mesurer sur des données jamais vues.
- Entraîné sur primitives ET raccourcis. Garder les horizons courts (les erreurs se cumulent).
- Un seul modèle partagé entre bots ; la diversité vient des rôles, prompts, seuils de risque et mémoires, pas du modèle.
  Si les bots diffèrent par leurs capacités ou leur monde, ajouter un identifiant de rôle en entrée.
- Pas de JEPA ni de pixels tant que l'état reste structuré et petit. Ajout de JEPA ou pixels ensuite pour complexifier.
- But à terme : un espace latent partagé entre le LLM, le world model et les résultats des compétences.
  Cela demande un modèle OUVERT chargé en Python (accès aux représentations internes), d'où le cerveau en Python.
  En attendant, LLM et world model communiquent par du texte/JSON ; ne rien faire qui empêche ce passage.

## Versions et environnement
- Minecraft/Paper 1.21.11 (dernière version officiellement supportée par Mineflayer).
  Les versions 26.x ne sont PAS supportées officiellement par Mineflayer : ne pas migrer ni utiliser de fork ou de ViaVersion.
- Java 21. Serveur lancé via `server/run.sh` (flags JVM, `-Xms` = `-Xmx`).
- LLM : petit modèle ouvert en local (cible : RTX 4090, quand le PC est disponible). Voix a terme dans un deuxieme temps
  L'appel au LLM passe par UNE seule fonction remplaçable (fournisseur interchangeable : API pendant le dev, local ensuite).

## Feuille de route (mise à jour)
5. Compétences : primitives générales d'abord (move_to, break_block, place_block, craft, ...),
   [lot 1 fait : move_to, break_block, place_block, craft, eat, find, scan, explore, mine ; lot 2 : attack, equip, use_item, container, smelt, wait]
   puis raccourcis (mine, goto), puis find/scan/explore. Chaque compétence testée ~10 fois.
6. Agent LLM baseline avec le champ `missing_capability` ; mesurer où il échoue.
   Le LLM prend directement les sorties de Node (pas encore de world model) : c'est la baseline de l'étape 8.
7. World model supervisé sur le journal.
8. Brancher le world model comme filtre, test A/B (avec/sans), et comparer petit/gros modèle.
Après l'étape 8 seulement : macros enregistrées par le LLM, planificateur sur le world model
(moins d'appels LLM), multi-bots, éventuellement RL sur un comportement qui plafonne.

## Manière de travailler avec l'utilisateur
- Petites étapes, une à la fois, chacune avec un critère de réussite vérifiable.
- Expliquer simplement le JavaScript (commentaires en français, pas de jargon inutile).
- Côté Python, décrire d'abord ce qui sera implémenté ; l'utilisateur décide ce que Claude écrit et ce qu'il écrit lui-même.
- Ne pas sur-construire : pas de framework, pas d'abstractions prématurées.
- Annoncer ce qui a été testé et ce qui ne l'a pas été (le jeu réel n'est pas simulable ici).

