# mc-agent

Agent Minecraft qui raisonne et parle (LLM), et anticipe les conséquences de ses actions (world model),
branché sur le VRAI jeu via Mineflayer. Projet d'apprentissage : l'utilisateur débute en JavaScript.

## Architecture (carte détaillée, un fichier par ligne : `docs/overview.md`)
- `server/` : serveur Paper 1.21.11 local (online-mode=false). Le bot est op.
- `bot/` : Node.js, Mineflayer + mineflayer-pathfinder, modules ES (`import`/`export`, `"type": "module"`).
  Extension `.js` obligatoire dans les chemins relatifs. Les bibliothèques CommonJS (Mineflayer, pathfinder...)
  s'importent par défaut puis se déstructurent : `import pf from 'mineflayer-pathfinder'; const { goals } = pf`
  (les imports nommés `import { goals } from ...` échouent).
  - `bot.js` : crée le bot ; modes `node --env-file=../.env bot.js serve` (API pour le cerveau),
    `suite <compétence|all> [N]` (arène), `field [N] [graine] [indice]` (banc terrain)
  - `src/api.js` : l'API HTTP (`GET /state`, `GET /skills`, `GET /run`, `POST /execute`)
  - `src/execute.js` : exécute une compétence et écrit sa ligne de journal (`src/logger.js`, `src/run.js` : où et quel run)
  - `src/runSkill.js` : enveloppe (timeout, capture d'erreurs, durée) ; `src/cancel.js` : une compétence arrêtée ne peut plus agir
  - `src/skills/` : une compétence par fichier, regroupées dans `index.js` (`utils.js` = fonctions partagées,
    `catalogue.js` = ce que lit le LLM ; `SHOWN_TO_LLM` = les compétences qui lui sont montrées pour l'instant)
  - `src/movements.js` : réglages du pathfinder (déplacements débrouillards + instincts), `src/fixes.js` : correctifs de bugs Mineflayer
  - `src/state.js` : `observe(bot)` = LA définition unique de l'état (pas de pixels), utilisée par l'API et le journal
  - `src/trace.js` : ce qui se passe pendant une compétence (touches, trajectoire, actions, blocs, entités, événements)
  - `src/commands.js` : `runCommand`, envoyer une commande serveur
  - `tests/unit/` (`npm test`, faux bot, sans serveur), `tests/game/` (arène reproductible, taux de réussite),
    `tests/field/` (lieux naturels tirés au hasard : taux de réussite ET répartition des raisons d'échec)
- `data/` (ignoré par git, format : `docs/journal.md`) : `runs.jsonl`, `transitions.jsonl`, `episodes.jsonl`.
  `MC_DATA_PURPOSE=dev` (défaut) -> `data/dev/`, jetable ; `collection` -> `data/collection/<run_id>/`.
  Les données de développement ne servent JAMAIS à l'entraînement.
- `brain/` (Python géré par uv, tests : `uv run pytest`) : agent LLM, puis world model supervisé (PyTorch).
  `agent.py` boucle, `llm.py` l'unique appel au LLM, `render.py` TOUS les textes lus par le LLM, `body.py` client HTTP,
  `journal.py` épisodes. Lancer un épisode : `uv run python -m brain.agent "but" --max-turns N`.
- `notebooks/explore_body.ipynb` : explorer l'API, le journal, et la boucle avec un faux ou un vrai LLM.
- Communication corps/cerveau : Node (le corps) expose une petite API HTTP locale ; Python (le cerveau) l'appelle.
  Node peut contenir des logiques de décision (réflexes, choix internes d'une compétence, et plus si c'est utile) ;
  Python ne parle jamais directement à Minecraft.

## Conventions à respecter
- Une compétence est `async function nom(bot, args)` et renvoie TOUJOURS `{ success, reason, details }`
  (`runSkill` ajoute `duration`). Les échecs sont rapportés honnêtement, jamais masqués.
- Chaque compétence a un timeout dur (via `runSkill`). Aucune exception ne doit s'échapper.
- Toujours appeler `execute(bot, name, args, source)`, jamais `runSkill` seul, pour que tout soit journalisé.
- La version de Minecraft vit uniquement dans `.env` (MC_VERSION). Ne jamais l'écrire en dur.
- Ne pas mettre à jour les dépendances (pas de `npm audit fix`, `npm update`) : versions figées par package-lock.json.
- Le bot est créé une seule fois dans `bot.js` et passé en argument ; les modules ne créent pas de bot.
- Le journal est la matière première du world model : ne jamais le modifier à la main ni filtrer les échecs.
- Un seul format d'état : `observe`. Le LLM ne le lit pas brut : le cerveau en fabrique un texte court pour le prompt
  (une présentation, pas un second format). Tout champ ajouté doit rester optionnel pour les anciennes lignes.
- Pas de numéros de version écrits à la main (ni par compétence, ni pour le catalogue) : le commit git identifie le code.
  Une collecte (`MC_DATA_PURPOSE=collection`) refuse de démarrer si le code n'est pas commité.
- Ne jamais accélérer le serveur (`/tick rate`) pour collecter : Mineflayer reste en temps réel, les données seraient faussées.
- Commandes serveur envoyées par notre code : toujours via `src/commands.js` (`runCommand`).
- Format du journal GELÉ jusqu'à l'étape 7 : pas de nouveau champ. On garde ce qui aide à comprendre une compétence maintenant.
- Ne pas stocker ce qui se recalcule exactement à partir du journal (liste dans `docs/journal.md`).

## Philosophie des compétences (décision de conception)
- Le LLM COMPOSE : il enchaîne des compétences pour atteindre un but. Ne pas écrire une compétence par objectif.
- Deux niveaux :
  - Primitives générales et indépendantes, paramétrées par coordonnées ou cible :
    `move_to(x,y,z)`, `break_block(x,y,z)` (casse seulement), `pick_up(item)` (ramasse), `place_block(item,x,y,z)`, `use_item(item,cible)`,
    `attack(entité)`, `container(position,action,item,quantité)`, `craft`, `smelt`, `equip`, `eat`, `wait`.
  - Raccourcis (macros) pour l'efficacité : `collect_block(x,y,z)` = break_block + pick_up, `mine(block,count)` = find + collect_block répétés. `flee` = `find(hostile)` + `move_to` : pas de raccourci pour l'instant.
    Un raccourci est un assemblage de primitives (ex. mine = find + collect_block), pas un code à part.
    Un raccourci évite au LLM d'enchaîner des primitives trivialement cumulables (ex. casser puis ramasser).
- Compétences "questions" (sans effet sur le monde) : `find(bloc|entité)` et `scan`, pour que le LLM sache où sont les ressources.
- Le LLM ne voit qu'une partie des compétences (`SHOWN_TO_LLM`) : un petit modèle choisit mieux parmi peu d'options.
  Les textes montrés au LLM ne doivent pas renvoyer vers une compétence cachée.
- Toujours avoir `explore(direction, distance)` : sinon `block_not_found` bloque le LLM.
- Préférer peu de compétences génériques à beaucoup de spécifiques. Départ : 8 à 10, plafond visé : 20 à 30.
- Noms et signatures STABLES pour les données COLLECTÉES : les compétences sont des entrées du world model, renommer
  casse les données de collecte. Pendant le développement (données jetables), renommer ne pose aucun problème.
- Ne pas écrire de primitive trop restrictive (ex. `place` "à côté du bot") : utiliser des coordonnées dès le départ.
- Chaque compétence vérifie ses prérequis et renvoie une raison explicite
  (`missing_ingredients`, `no_tool`, `block_not_found`, `no_path`, `timeout`...) que le LLM peut exploiter.
- Contrôle d'expressivité : une liste de tâches variées (abri 3x3, planter du blé, tuer et cuire une vache,
  ranger dans un coffre, traverser un ravin) doit pouvoir s'écrire comme suite de primitives.
  Une tâche inexprimable = il manque une primitive.

## LLM et boucle de décision
- L'outil `propose_plans` du LLM contient un champ optionnel `missing_capability` (ce dont il aurait eu besoin).
  Le journaliser ; ajouter des primitives selon la fréquence de ces demandes, pas par intuition.
  Limite constatée : `qwen2.5:3b` l'a laissé vide dans TOUS les épisodes, même bloqué. Un petit modèle dit mal ce qui
  lui manque : le signal sera faible. Pour mesurer les manques, prévoir un modèle plus gros ponctuellement, ou une
  question explicite après un échec (« quelle compétence t'aurait permis de réussir ? »), en plus du contrôle
  d'expressivité fait à la main.
- Renvoyer au LLM les résultats structurés `{success, reason, details}` pour qu'il corrige son plan.
- Chaque compétence est décrite en langage clair dans le prompt (quand l'utiliser, paramètres, limites).
- Plus tard (après l'étape 8) : le LLM pourra ENREGISTRER un plan réussi comme nouveau raccourci, sous forme
  de DONNÉES (liste d'appels de primitives avec paramètres), jamais du code arbitraire exécuté.
  Si des boucles ou conditions sont nécessaires, concevoir un mini-langage simple.
- Voyager (Wang et al. 2023) est une inspiration et une baseline, pas à reproduire : il fait écrire du code au LLM
  et n'a pas de modèle appris. Notre différence : primitives écrites à la main + world model entraîné
  (prédiction avant l'action, détection de surprise après).

## Journal : un format solide (matière première du world model et du futur espace latent)
- Format exact (champs, versions, exemples) : `docs/journal.md`. Le tenir à jour à chaque changement de version.
- Deux fichiers JSONL, une ligne = un événement, jamais réécrits :
  - `data/transitions.jsonl` (écrit par Node) : une ligne par compétence exécutée.
  - `data/episodes.jsonl` (écrit par Python) : but, prompt, réponse brute du LLM, plan, `missing_capability`, résultat final.
- Chaque ligne porte un `schema_version` ; changer le format = nouvelle version, pas de réécriture des anciennes lignes.
- Les transitions d'un épisode LLM portent l'`episode_id` et le numéro de tour (`turn`), pour relier plan et résultats.
- Garder la réponse brute du LLM (pas seulement le plan interprété) : elle servira à entraîner le lien LLM <-> world model.
- Noter dans chaque épisode le modèle utilisé (nom, version) et la version du code (commit git).

## World model
- Supervisé (pas du RL) : (état, compétence) -> succès, durée, danger, delta d'inventaire. Ensemble de MLP, l'incertitude vient du désaccord.
- Toujours comparer à des baselines triviales (taux de base, médiane) et mesurer sur des données jamais vues.
- Entraîné sur primitives ET raccourcis. Garder les horizons courts (les erreurs se cumulent).
- Volume de données : Mineflayer est en temps réel (environ 300 transitions par heure et par bot). Pistes : plusieurs
  bots en parallèle (certain), accélérer si on trouve un moyen qui ne fausse pas les données (voir la règle sur
  `/tick rate`), données annexes trouvées sur internet. La place disque n'est pas un problème (plusieurs To sur la
  vraie machine).
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
  Actuellement : Ollama + `qwen2.5:3b` sur Mac M2 16 Go (API compatible OpenAI, `LLM_MODEL`, `LLM_BASE_URL`).
  Pas de RAG, LangChain ni LangGraph. Sortie du LLM non contrainte pour l'instant (outil + JSON de secours).

## Feuille de route (mise à jour)
5. Compétences : primitives générales d'abord, puis raccourcis, puis questions et exploration.
   [fait : move_to, break_block, pick_up, place_block, craft, eat, find, scan, explore, collect_block, mine ;
    lot 2 : attack, equip, use_item, container, smelt, wait]
6. Agent LLM baseline avec le champ `missing_capability` ; mesurer où il échoue.
   Le LLM prend directement les sorties de Node (pas encore de world model) : c'est la baseline de l'étape 8.
7. World model supervisé sur le journal.
8. Brancher le world model comme filtre, test A/B (avec/sans), et comparer petit/gros modèle.
Après l'étape 8 seulement : macros enregistrées par le LLM, planificateur sur le world model
(moins d'appels LLM), multi-bots, éventuellement RL sur un comportement qui plafonne.

## État actuel et prochaines étapes (mettre à jour en fin de session)
- Méthode décidée : mesurer les primitives sur le BANC TERRAIN (`bot.js field`, lieux naturels, même graine pour
  comparer), corriger par fréquence et par cause racine, relancer la même graine. L'arène ne sert qu'aux régressions.
  « Robuste » = borné en temps, raison d'échec honnête, ~90 % sur le banc terrain (pas 100 %).
- Cause racine trouvée : la physique de Mineflayer collait le bot exactement contre les murs, Paper le renvoyait en
  arrière à chaque tick (bot figé) -> `fixWallContact` (src/fixes.js). Banc terrain graine 1 : move_to 11 % -> 100 %,
  explore 5 % -> 100 %, mine 67 % -> 100 % (19 lieux seulement).
- Conception à 3 niveaux sur les mêmes primitives : réflexes dans Node (à l'intérieur d'une compétence, au tick),
  tactique après un échec (d'abord des RÈGLES écrites dans `brain/recovery.py`, suites de primitives sous forme de
  DONNÉES ; plus tard choisies par le world model, éventuellement un petit modèle appris), stratégie = le LLM.
- Prochaines étapes, dans l'ordre :
  1. Corriger le banc terrain (lieux inaccessibles à remplacer, case libre pour place_block), puis 50 lieux sur une
     nouvelle graine.
  2. Options de stratégie pour `move_to`/`explore` (`dig`, `build`, `max_drop`, `avoid_water`), primitive courte
     `step(direction, count)` (sans pathfinder, saute 1 bloc, s'arrête sur wall/drop/hazard/water), réflexe de
     déblocage générique.
  3. `brain/recovery.py` (règles), mesuré sur le banc avec/sans.
  4. Relancer des épisodes LLM (« collect 3 oak logs », « craft a wooden pickaxe »).
- L'utilisateur relit le code (ordre : `docs/overview.md`) ; rien n'est commité depuis `6fc30a3` : proposer un commit.

## Pièges pratiques
- Le bot de l'utilisateur (`bot.js serve`) et celui des tests s'appellent tous deux `Agent` : avant une suite ou le banc,
  vérifier que l'API (port 3000) est arrêtée et demander à l'utilisateur d'arrêter son bot. Ne jamais arrêter
  soi-même les processus de l'utilisateur (serveur, bot, terminaux).
- Le monde est en `peaceful` : les suites `eat` (la faim ne baisse pas) et `scan` (le husk disparaît) ne peuvent pas
  se mettre en place.
- Lancer les longs tests avec `caffeinate -i` (le Mac ne doit pas se mettre en veille).
- L'éditeur de l'utilisateur reformate certains fichiers (guillemets doubles, points-virgules) : suivre le style du fichier.

## Manière de travailler avec l'utilisateur
- Petites étapes, une à la fois, chacune avec un critère de réussite vérifiable.
- Expliquer simplement le JavaScript (commentaires clairs, pas de jargon inutile).
- Côté Python, décrire d'abord ce qui sera implémenté ; l'utilisateur décide ce que Claude écrit et ce qu'il écrit lui-même.
- Ne pas sur-construire : pas de framework, pas d'abstractions prématurées.
- Annoncer ce qui a été testé et ce qui ne l'a pas été (le jeu réel n'est pas simulable ici).
- Le code est en ANGLAIS : noms de fichiers, variables, fonctions, commentaires, messages de log et d'erreur,
  noms des tests, descriptions du catalogue (lues par le LLM). Seuls CLAUDE.md et la conversation restent en français.

