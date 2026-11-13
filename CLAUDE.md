# mc-agent

Agent Minecraft qui raisonne et parle (LLM), et anticipe les conséquences de ses actions (world model),
branché sur le VRAI jeu via Mineflayer. Projet d'apprentissage : l'utilisateur débute en JavaScript.

Ce fichier ORIENTE : le but, les principes, les règles, où trouver le reste. Il ne décrit pas l'état du
moment : celui-ci vit dans `docs/status.md`, daté, et se vérifie.

## Pour ne pas perdre le fil
- Où on en est, ce qui a été mesuré, décidé ou essayé puis retiré : `docs/status.md`. Le lire avant de choisir
  la suite ou de reprendre une idée (elle a peut-être déjà été essayée), le mettre à jour en fin de session.
- Carte du code, un fichier par ligne : `docs/overview.md`. Architecture CIBLE (composants, qui décide à chaque
  étape, liaisons, étapes A à J) : `docs/architecture.md`, à consulter avant de concevoir un composant et à
  tenir à jour quand une décision change. Format du journal : `docs/journal.md`. Champs échangés entre le
  corps et le cerveau : `docs/api_contract.json` (vérifié des deux côtés par les tests).
- Ce qui VARIE se vérifie au lieu d'être supposé : la difficulté et la graine du monde (`run_start` dans
  `runs.jsonl`, `GET /state`), le modèle et le contexte du LLM (`.env`, les épisodes), si le bot de
  l'utilisateur tourne (port 3000), le résultat des tests (les relancer), toute mesure (datée dans
  `docs/status.md` : la refaire si le code ou le monde a changé). Ne pas conclure qu'une chose est impossible
  ou cassée sans l'avoir vérifié maintenant.

## Organisation du dépôt
- `server/` (ignoré par git) : serveur Paper local (online-mode=false), le bot est op.
- `scripts/` : démarrer le bot (`start_bot.sh [mode]`) et le serveur (`server_start.sh`, `server_stop.sh`),
  choisir ou changer de monde (`use_world.sh`, `change_world.sh` ; un monde marqué `worlds/<graine>/keep` n'est
  jamais supprimé). Chaque script dit son usage en tête.
- `bot/` (le corps) : Node.js, Mineflayer + mineflayer-pathfinder, modules ES. `bot.js` crée le bot (modes
  `serve` pour l'API du cerveau, `suite` pour l'arène, `field` pour le banc terrain). `src/` est rangé par rôle :
  `api/`, `execution/`, `journal/`, `observation/`, `game/`, `skills/` (`actions/`, `questions/`, `shortcuts/`,
  `low_level/`). Une nouvelle compétence va dans le dossier de sa famille et dans `skills/index.js`.
  - Extension `.js` obligatoire dans les chemins relatifs. Les bibliothèques CommonJS (Mineflayer, pathfinder...)
    s'importent par défaut puis se déstructurent : `import pf from 'mineflayer-pathfinder'; const { goals } = pf`
    (les imports nommés `import { goals } from ...` échouent).
- `brain/` (le cerveau) : Python géré par uv. Agent LLM (`agent.py` la boucle, `llm.py` l'unique appel au LLM,
  `render.py` TOUS les textes lus par le LLM, `body.py` le client HTTP du corps, `goal.py` la condition de but,
  `journal.py` les épisodes), outils (`show.py` relire un épisode, `bench.py` le banc d'épisodes), puis le
  world model. Commandes : en tête de chaque fichier et dans `docs/overview.md`.
- `data/` (ignoré par git, format : `docs/journal.md`) : `MC_DATA_PURPOSE=dev` (défaut) -> `data/dev/`, jetable ;
  `collection` -> `data/collection/<run_id>/`. Les données de développement ne servent JAMAIS à l'entraînement.
- `notebooks/` : explorer l'API, le journal, et la boucle avec un faux ou un vrai LLM.
- Communication : le corps (Node) expose une petite API HTTP locale, le cerveau (Python) l'appelle. Node peut
  contenir des logiques de décision (réflexes, choix internes d'une compétence) ; Python ne parle jamais
  directement à Minecraft.

## Tests (détail : `docs/overview.md`)
Cinq niveaux, du plus rapide au plus réaliste ; chacun attrape ce que le précédent ne voit pas :
tests unitaires JS (`npm test`, faux bot) et Python (`uv run pytest`, faux corps et faux LLM) à chaque
changement ; l'arène (`bot.js suite`, décor reproductible : régressions, cas limites, faux succès) après un
changement de compétence ; le banc terrain (`bot.js field`, lieux naturels : taux ET raisons d'échec, ce qu'on
n'a pas imaginé) avant de collecter ; le banc d'épisodes (`brain.bench`, tout le système : succès VÉRIFIÉ sur
l'état) pour comparer modèles et composants. Relire le journal est aussi un test (traces, tailles, clics réels).

## Conventions à respecter
- Une compétence est `async function nom(bot, args)` et renvoie TOUJOURS `{ success, reason, details }`
  (`runSkill` ajoute `duration`). Les échecs sont rapportés honnêtement, jamais masqués.
- Arrêt d'une compétence (`src/execution/runSkill.js`), pas un temps limite unique : son BUDGET (estimation tirée
  des faits du jeu, `skill.budget(bot, args)`), PLUS DE PROGRÈS, une ALERTE (blessé, ou un NOUVEAU monstre proche :
  le cerveau décide), le temps donné par le cerveau (`max_seconds`), et un plafond dur contre les bugs (`too_long`
  si le budget le dépasse). Aucune exception ne doit s'échapper. Le plafond est TEMPORAIRE comme limite de
  comportement : à terme `too_long` deviendra une décision du cerveau (durée annoncée, puis prédite par le world
  model) et il ne restera qu'un garde-fou très large.
- Toujours appeler `execute(bot, name, args, source)`, jamais `runSkill` seul, pour que tout soit journalisé.
- La version de Minecraft vit uniquement dans `.env` (MC_VERSION). Ne jamais l'écrire en dur.
- Ne pas mettre à jour les dépendances (pas de `npm audit fix`, `npm update`) : versions figées par package-lock.json.
  Ne jamais modifier `node_modules` : un bug de Mineflayer se corrige depuis notre code (`src/game/fixes.js`).
- Le bot est créé une seule fois dans `bot.js` et passé en argument ; les modules ne créent pas de bot.
- Le journal est la matière première du world model : ne jamais le modifier à la main ni filtrer les échecs.
- Un seul format d'état : `observe`. Le LLM ne le lit pas brut : le cerveau en fabrique un texte court pour le prompt
  (une présentation, pas un second format). Tout champ ajouté doit rester optionnel pour les anciennes lignes.
- Pas de numéros de version écrits à la main (ni par compétence, ni pour le catalogue) : le commit git identifie le code.
  Une collecte (`MC_DATA_PURPOSE=collection`) refuse de démarrer si le code n'est pas commité.
- Ne jamais accélérer le serveur (`/tick rate`) pour collecter : Mineflayer reste en temps réel, les données seraient faussées.
- Commandes serveur envoyées par notre code : toujours via `src/game/commands.js` (`runCommand`).
- Le format du journal ÉVOLUE avec le projet, il n'est jamais gelé : chaque changement = nouvelle
  `schema_version`, décrite dans `docs/journal.md` ; les anciennes lignes ne sont jamais réécrites, et le code qui
  lit le journal (world model) dit quelles versions il sait lire. Une petite collecte est un TEST (vérifier la
  chaîne, mesurer, nourrir le code d'entraînement), pas un engagement sur le format.
- Les compétences appelées À L'INTÉRIEUR d'une compétence (étapes d'un raccourci) ont leur propre ligne,
  reliée par `parent_seq` (`src/execution/steps.js`), sans trace (c'est une tranche de la trace du haut).
- Ne pas stocker ce qui se recalcule exactement à partir du journal (liste dans `docs/journal.md`).
- Un champ lu par le cerveau dans une réponse du corps est déclaré dans `docs/api_contract.json`.

## Philosophie des compétences (décision de conception)
- Le LLM COMPOSE : il enchaîne des compétences pour atteindre un but. Ne pas écrire une compétence par objectif.
- Deux niveaux :
  - Primitives générales et indépendantes, paramétrées par coordonnées ou cible : `move_to(x,y,z)`,
    `break_block(x,y,z)` (casse seulement), `pick_up(item)` (ramasse), `place_block(item,x,y,z)`,
    `use_item(item,cible)`, `attack(entité)`, `container(position,action,item,quantité)`, `craft`, `smelt`,
    `equip`, `eat`, `wait` (celles qui sont écrites : `docs/status.md`).
  - Raccourcis (macros) pour l'efficacité : `collect_block` = break_block + pick_up, `mine` = find +
    collect_block répétés. Un raccourci est un assemblage de primitives, pas un code à part ; il évite au LLM
    d'enchaîner des primitives trivialement cumulables (casser puis ramasser).
- Bas niveau, sans pathfinder, CACHÉES au LLM : `walk`, `look`, `press` (entrée BRUTE, sans vérification).
  Redondantes exprès : issue de secours quand le pathfinder bloque (tactiques), données variées et courtes
  (exploration au hasard), futur contrôleur appris.
- Compétences « questions » (sans effet sur le monde) : `find`, `scan` (où sont les choses), `recipe` (une page du
  livre de recettes, STRICTEMENT un niveau, dans les deux sens : ingrédients d'un objet, ou ce qu'on fabrique avec),
  `craftable` (ce que l'inventaire permet maintenant). Les recettes sont des FAITS du jeu : les donner n'est pas
  tricher (un joueur a le livre et le wiki), c'est un réglage ; mais une question = une réponse, sans raisonnement
  caché du corps. Les faits du jeu viennent de Mineflayer ; la mémoire gardera ce que l'agent SAIT (son
  expérience), jamais une copie des données du jeu.
- Le LLM ne voit qu'une partie des compétences (`SHOWN_TO_LLM`) : un petit modèle choisit mieux parmi peu
  d'options. Les textes montrés au LLM ne doivent pas renvoyer vers une compétence cachée.
- Toujours avoir `explore(direction, distance)` : sinon `block_not_found` bloque le LLM.
- Préférer peu de compétences génériques à beaucoup de spécifiques (plafond visé : 20 à 30).
- Les compétences sont des entrées du world model : AJOUTER une compétence ne gêne jamais les données ; modifier une
  compétence existante (nom, arguments, comportement) reste possible pour progresser, mais c'est un changement de
  format : le noter dans `docs/journal.md` (nouvelle version, correspondance avec l'ancien nom) pour que les
  anciennes lignes restent lisibles. Éviter seulement les changements gratuits.
- Ne pas écrire de primitive trop restrictive (ex. `place` « à côté du bot ») : des coordonnées dès le départ.
- Chaque compétence vérifie ses prérequis et renvoie une raison explicite (`missing_ingredients`, `no_tool`,
  `block_not_found`, `no_path`...) que le LLM peut exploiter.
- Qui gère un imprévu ? La COMPÉTENCE si c'est (1) dans sa promesse (collect_block = casser ET ramasser),
  (2) sans vrai choix dépendant du but (un joueur compétent n'y réfléchirait pas), (3) local, court et borné.
  La TACTIQUE (`brain/recovery.py`) pour une réaction connue à un échec, écrite en suite de primitives. Le LLM dès
  qu'il y a un arbitrage ou des conséquences (dépenser, casser du précieux, risquer, choisir entre options).
  Ce que la compétence fait en plus se VOIT dans `details` et reste borné.
- Une politique générale, pas une règle par situation : ce qui peut être cassé en passant, ce qui est dangereux,
  vit une seule fois dans `src/game/movements.js` et toutes les compétences en héritent. Chercher la cause générale
  (ex. `not_collected` : pas « les feuilles », mais une cible qui BOUGE). Seules exceptions : quelques instincts de
  sécurité (lave, chutes).
- Les FAITS du jeu viennent du jeu, pas de listes écrites par nous : données de Mineflayer (dureté, outils,
  recettes) et tags du serveur (`src/game/tags.js`). Nos listes ne gardent que nos CHOIX (ce qu'on protège, ce
  qu'on évite, les blocs jetables). Un tag n'est pas toujours toute la règle : on essaie, et la vérification après
  coup le dit.
- Le corps EXÉCUTE la mécanique (comment), le world model et les autres têtes apprises CHOISISSENT (quand, quoi,
  quelle réaction). Les frictions de bas niveau se corrigent dans les compétences, pas en attendant un modèle plus
  fort : des compétences fiables rendent tous les modèles meilleurs et donnent des données propres.
- Paramètres par défaut pensés pour le cas courant (ex. `move_to` s'arrête à côté d'une cible pleine) ; la
  précision reste possible.
- Contrôle d'expressivité : des tâches variées (abri 3x3, planter du blé, tuer et cuire une vache, ranger dans un
  coffre, traverser un ravin) doivent pouvoir s'écrire comme suite de primitives. Une tâche inexprimable = il
  manque une primitive.

## LLM et boucle de décision
- Chaque compétence est un OUTIL déclaré au LLM ; les appels d'une réponse, dans l'ordre, forment le plan.
  Deux outils en plus : `goal_reached` et `missing_capability` (ce dont il aurait eu besoin : le journaliser, et
  ajouter des primitives selon la fréquence de ces demandes, pas par intuition).
- Condition de but (`brain/goal.py`) : avant la boucle, un appel séparé à un seul outil `define_goal` traduit le but
  en DONNÉES (`{"have": {"oak_log": 3}}`) ; le code la vérifie à chaque état, termine l'épisode et refuse un
  `goal_reached` trop tôt. Sans condition possible (« construis un abri ») : `goal_reached`.
- Arguments des outils PLATS (pas d'objet imbriqué) : les petits modèles les ferment mal.
- Renvoyer au LLM les résultats structurés `{success, reason, details}` pour qu'il corrige son plan.
- Chaque compétence est décrite en langage clair dans le catalogue (quand l'utiliser, paramètres, limites).
- Plus tard : le LLM pourra ENREGISTRER un plan réussi comme nouveau raccourci, sous forme de DONNÉES (liste
  d'appels de primitives avec paramètres), jamais du code arbitraire exécuté (un mini-langage si besoin).
- Voyager (Wang et al. 2023) est une inspiration et une baseline, pas à reproduire : il fait écrire du code au LLM
  et n'a pas de modèle appris. Notre différence : primitives écrites à la main + world model entraîné
  (prédiction avant l'action, détection de surprise après).
- Ce qui a été essayé puis retiré pour la boucle et le prompt (réflexion avant les appels, outil `propose_plans`,
  sous-buts `add_step`...) : `docs/status.md`, section 3.

## Architecture cognitive : chaque connaissance à sa place (décision de conception)
- But du projet : une architecture pensée, pas un LLM qui force le problème en brut. Le LLM est le composant le plus
  cher, le plus lent et le moins fiable : il ne reçoit que ce qu'il doit DÉCIDER, le reste est calculé ailleurs.
- Une connaissance va au composant qui correspond à sa nature :
  - immédiate, au tick (ne pas tomber, contourner la lave) -> réflexes dans Node ;
  - répétitive (que faire après `no_path`) -> tactique (`brain/recovery.py`, règles puis appris) ;
  - régularité statistique (ce que produit une action dans un état) -> world model (appris, incertitude mesurable) ;
  - fait exact propre à ce monde (où sont le coffre, les arbres, ce qui est exploré) -> mémoire structurée tenue par
    le cerveau (des DONNÉES, mises à jour à partir des résultats des compétences) ;
  - but, ordre des étapes, langage -> le LLM.
- Les sources d'action, de perception et de décision se diversifient progressivement (écrites, puis apprises,
  puis l'image), toujours derrière les mêmes interfaces (`execute`, `observe`, le journal) : un ajout à la fois,
  mesuré avec et sans ; un composant appris s'AJOUTE et ne remplace pas une compétence déterministe fiable.
- À terme, le prompt est une VUE CONSTRUITE à chaque tour par `render.py` (but, état, faits utiles de la mémoire,
  prédictions du world model, dernier résultat, une ligne par tour passé), pas une conversation qui s'allonge.
  Chaque bloc de la vue = un composant ajouté UN à la fois et mesuré sur le banc d'épisodes.
- Les correctifs de prompt pour un petit modèle sont des rustines mesurées, pas de l'architecture : à remettre en
  cause si le modèle ou la forme du prompt change. Le prompt caching n'agrandit pas la mémoire : il accélère, à
  condition de garder le début du prompt stable.

## Journal : un format solide (matière première du world model et du futur espace latent)
- Format exact (champs, versions, exemples) : `docs/journal.md`. Le tenir à jour à chaque changement de version.
- Fichiers JSONL, une ligne = un événement, jamais réécrits : `transitions.jsonl` (Node, une ligne par compétence),
  `episodes.jsonl` (Python : but, prompt, réponse brute du LLM, plan, `missing_capability`, résultat), `runs.jsonl`.
- Chaque ligne porte un `schema_version` ; changer le format = nouvelle version, pas de réécriture des anciennes lignes.
- Les transitions d'un épisode portent l'`episode_id` et le numéro de tour (`turn`), pour relier plan et résultats.
- Garder la réponse brute du LLM (pas seulement le plan interprété) : elle servira à entraîner le lien LLM <-> world model.
- Noter dans chaque épisode le modèle utilisé et la version du code (commit git).

## World model
- Supervisé (pas du RL) : (état, compétence) -> succès, durée, danger, delta d'inventaire. Ensemble de MLP,
  l'incertitude vient du désaccord. Entraîné sur primitives ET raccourcis, horizons courts.
- Toujours comparer à des baselines triviales (taux de base, médiane) et mesurer sur des données jamais vues.
- Volume de données : Mineflayer est en temps réel. Pistes : plusieurs bots en parallèle, accélérer seulement par
  un moyen qui ne fausse pas les données (voir `/tick rate`), données annexes. La place disque n'est pas un problème.
- Un seul modèle partagé entre bots ; la diversité vient des rôles, prompts, seuils de risque et mémoires. Si les
  bots diffèrent par leurs capacités ou leur monde, ajouter un identifiant de rôle en entrée.
- Pas de JEPA ni de pixels tant que l'état reste structuré et petit ; ensuite, pour complexifier.
- But à terme : un espace latent partagé entre le LLM, le world model et les résultats des compétences. Cela demande
  un modèle OUVERT chargé en Python (accès aux représentations internes), d'où le cerveau en Python. En attendant,
  LLM et world model communiquent par du texte/JSON ; ne rien faire qui empêche ce passage.

## Versions et environnement (choix décidés)
- Minecraft/Paper 1.21.11 : la dernière version officiellement supportée par Mineflayer. Ne pas migrer vers une
  version non supportée, ni utiliser de fork ou de ViaVersion. Java 21, serveur lancé via `server/run.sh`.
- LLM : petit modèle ouvert en local (cible : une RTX 4090 ; pour l'instant un Mac). L'appel passe par UNE seule
  fonction remplaçable (`brain/llm.py`, API compatible OpenAI) ; le modèle utilisé se lit dans `.env`. Voix plus tard.
- Pas de RAG, LangChain ni LangGraph.

## Feuille de route
5. Compétences : primitives générales, raccourcis, questions et exploration.
6. Agent LLM baseline avec `missing_capability` et le banc d'épisodes : la référence de l'étape 8.
7. World model supervisé sur le journal (données de COLLECTE).
8. Le world model comme filtre, test A/B (avec/sans), petit/gros modèle.
Au-delà : `docs/architecture.md` (étapes A à J) et les pistes de `docs/status.md` (section 5). Où on en est : `docs/status.md`.

## Pièges pratiques
- Le bot de l'utilisateur (`bot.js serve`) et celui des tests s'appellent tous deux `Agent` : avant une suite ou un
  banc, vérifier que l'API (port 3000) est arrêtée et demander à l'utilisateur d'arrêter son bot. Ne jamais arrêter
  soi-même les processus de l'utilisateur (serveur, bot, terminaux).
- Certaines suites dépendent du monde (difficulté : la faim ne baisse pas et les monstres disparaissent en paisible) :
  lire la difficulté du run avant de conclure qu'une suite est cassée ou impossible.
- Lancer les longs tests avec `caffeinate -i`, sur secteur, écran ouvert (le Mac ne doit pas se mettre en veille).
- L'éditeur de l'utilisateur reformate certains fichiers (guillemets doubles, points-virgules) : suivre le style du fichier.

## Manière de travailler avec l'utilisateur
- Petites étapes, une à la fois, chacune avec un critère de réussite vérifiable.
- Expliquer simplement le JavaScript (commentaires clairs, pas de jargon inutile).
- Côté Python, décrire d'abord ce qui sera implémenté ; l'utilisateur décide ce que Claude écrit et ce qu'il écrit lui-même.
- Ne pas sur-construire : pas de framework, pas d'abstractions prématurées.
- Annoncer ce qui a été testé et ce qui ne l'a pas été (le jeu réel n'est pas simulable ici).
- Le code est en ANGLAIS : noms de fichiers, variables, fonctions, commentaires, messages de log et d'erreur,
  noms des tests, descriptions du catalogue (lues par le LLM), documents de `docs/`. Seuls CLAUDE.md et la
  conversation restent en français.
