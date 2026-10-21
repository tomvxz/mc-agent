# mc-agent

Agent Minecraft qui raisonne et parle (LLM), et anticipe les conséquences de ses actions (world model),
branché sur le VRAI jeu via Mineflayer. Projet d'apprentissage : l'utilisateur débute en JavaScript.

## Architecture (carte détaillée, un fichier par ligne : `docs/overview.md`)
- Architecture CIBLE (composants, boucle de décision, qui décide à chaque étape, liaisons, mémoire <-> espace
  latent, stabilité des compétences, étapes A à J) : `docs/architecture.md`. S'y référer avant de concevoir
  un nouveau composant, et la tenir à jour quand une décision change.
- `server/` : serveur Paper 1.21.11 local (online-mode=false). Le bot est op.
- `bot/` : Node.js, Mineflayer + mineflayer-pathfinder, modules ES (`import`/`export`, `"type": "module"`).
  Extension `.js` obligatoire dans les chemins relatifs. Les bibliothèques CommonJS (Mineflayer, pathfinder...)
  s'importent par défaut puis se déstructurent : `import pf from 'mineflayer-pathfinder'; const { goals } = pf`
  (les imports nommés `import { goals } from ...` échouent).
  - `bot.js` : crée le bot ; modes `node --env-file=../.env bot.js serve` (API pour le cerveau),
    `suite <compétence|all> [N]` (arène), `field [N] [graine] [indice]` (banc terrain)
  - `src/api.js` : l'API HTTP (`GET /state`, `GET /skills`, `GET /run`, `POST /execute`, `POST /setup`)
  - `src/setup.js` : mise en place d'un banc (lieu, inventaire, jour) ; pas une compétence, non journalisée
  - `src/execute.js` : exécute une compétence et écrit sa ligne de journal (`src/logger.js`, `src/run.js` : où et quel run)
  - `src/runSkill.js` : enveloppe (timeout, capture d'erreurs, durée) ; `src/cancel.js` : une compétence arrêtée ne peut plus agir
  - `src/skills/` : une compétence par fichier, regroupées dans `index.js` (`utils.js` = fonctions partagées,
    `catalogue.js` = ce que lit le LLM ; `SHOWN_TO_LLM` = les compétences qui lui sont montrées pour l'instant)
  - `src/movements.js` : réglages du pathfinder (déplacements débrouillards + instincts), `src/fixes.js` : correctifs de bugs Mineflayer
  - `src/state.js` : `observe(bot)` = LA définition unique de l'état (pas de pixels), utilisée par l'API et le journal
  - `src/trace.js` : ce qui se passe pendant une compétence (touches, trajectoire, actions, blocs, entités, événements)
  - `src/commands.js` : `runCommand`, envoyer une commande serveur
  - `src/tags.js` : les groupes de blocs DU JEU (tags envoyés par le serveur : replaceable, leaves, beds...)
  - `tests/unit/` (`npm test`, faux bot, sans serveur), `tests/game/` (arène reproductible, taux de réussite),
    `tests/field/` (lieux naturels tirés au hasard : taux de réussite ET répartition des raisons d'échec)
- `data/` (ignoré par git, format : `docs/journal.md`) : `runs.jsonl`, `transitions.jsonl`, `episodes.jsonl`.
  `MC_DATA_PURPOSE=dev` (défaut) -> `data/dev/`, jetable ; `collection` -> `data/collection/<run_id>/`.
  Les données de développement ne servent JAMAIS à l'entraînement.
- `brain/` (Python géré par uv, tests : `uv run pytest`) : agent LLM, puis world model supervisé (PyTorch).
  `agent.py` boucle, `llm.py` l'unique appel au LLM, `render.py` TOUS les textes lus par le LLM, `body.py` client HTTP,
  `journal.py` épisodes, `goal.py` la condition de but. Lancer un épisode : `uv run python -m brain.agent "but" --max-turns N`.
  Le lire : `uv run python -m brain.show [fin de l'id] [--full]` (`show.py`, lecture seule).
  Banc d'épisodes : `uv run python -m brain.bench [--task T] [--places N] [--seed S]` (`bench.py`) : succès VÉRIFIÉ
  sur l'état (pas seulement le goal_reached du LLM), tours, réponses inutilisables. Tâches : oak_logs, crafting_table.
- `notebooks/explore_body.ipynb` : explorer l'API, le journal, et la boucle avec un faux ou un vrai LLM.
- Communication corps/cerveau : Node (le corps) expose une petite API HTTP locale ; Python (le cerveau) l'appelle.
  Node peut contenir des logiques de décision (réflexes, choix internes d'une compétence, et plus si c'est utile) ;
  Python ne parle jamais directement à Minecraft.

## Conventions à respecter
- Une compétence est `async function nom(bot, args)` et renvoie TOUJOURS `{ success, reason, details }`
  (`runSkill` ajoute `duration`). Les échecs sont rapportés honnêtement, jamais masqués.
- Arrêt d'une compétence (`runSkill`), pas un temps limite unique : son BUDGET (estimation tirée des faits du jeu,
  `skill.budget(bot, args)` : distance, temps de creusage, nombre de blocs ; arrêt à 3x + 10 s, `timeout` ; refus
  avant de commencer si ça dépasse le plafond, `too_long`), PLUS DE PROGRÈS pendant 15 s (`no_progress`), une
  ALERTE (blessé, ou un NOUVEAU monstre à moins de 6 blocs : `alert`, le cerveau décide), plafond dur 300 s
  contre les bugs. Aucune exception ne doit s'échapper. Le plafond est TEMPORAIRE comme limite de comportement :
  quand toutes les compétences auront un budget, `too_long` deviendra une décision du cerveau (durée annoncée,
  plus tard prédite par le world model) et il ne restera qu'un garde-fou très large contre les bugs.
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
- Format du journal LIBRE tant que rien n'est collecté (les données de dev sont jetables) ; il sera GELÉ au
  premier run de collecte (`MC_DATA_PURPOSE=collection`). Chaque changement = nouvelle `schema_version`.
- Les compétences appelées À L'INTÉRIEUR d'une compétence (étapes d'un raccourci) ont leur propre ligne,
  reliée par `parent_seq` (`src/steps.js`), sans trace (c'est une tranche de la trace du haut).
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
- Bas niveau, sans pathfinder, CACHÉES au LLM : `walk(yaw, distance≤8)` (tout droit, saute les marches, mêmes
  instincts que le pathfinder : `dangerAhead`, lave, eau, chute > 3), `look(yaw, pitch)`, `press(keys, ticks≤40)`
  (touches tenues, entrée BRUTE : aucune vérification ni raison de danger). Angles en radians, convention de l'état.
  Redondantes exprès : issue de secours quand le pathfinder bloque (tactiques), données variées et courtes
  (exploration au hasard), futur contrôleur appris.
- Compétences "questions" (sans effet sur le monde) : `find(bloc|entité)` et `scan`, pour que le LLM sache où sont les ressources,
  et `recipe(item)` (une page du livre de recettes, STRICTEMENT un niveau : ingrédients, quantité produite, table ;
  rien sur la façon d'obtenir les ingrédients : le LLM redemande, `no_recipe` = ça se récolte). Dans les deux
  sens : `recipe(uses: X)` = ce qu'on fabrique directement AVEC X (la section « utilisation » du wiki) ; les
  variantes portent le groupe du jeu (`#planks`, comme la vraie recette), et `recipe("#planks")` donne la
  recette de chaque membre. `craftable()` = ce que l'inventaire permet MAINTENANT (le filtre « réalisables » du
  livre). Vu : le 14B, avec du bouleau, demandait `recipe(oak_planks)` (12 variantes sans lien avec son
  inventaire) : il fallait sinon interroger les planches une par une. Essayé puis retiré :
  un champ `how` par ingrédient et le choix du « bois utile » d'après les arbres proches, qui répondaient à la
  question suivante avant qu'elle soit posée (le corps faisait lui-même le lien bûche -> planches).
  Les recettes sont des FAITS du jeu, pas des décisions : les donner n'est pas tricher (un joueur a le livre de
  recettes et le wiki), c'est un réglage ; mais une question = une réponse, sans raisonnement caché du corps.
  Aujourd'hui toutes les recettes (données de Mineflayer, liées à MC_VERSION) ; plus tard, la mémoire filtrera
  les recettes à celles que l'agent a rencontrées (mode « débloquées », comme le livre du jeu) et on mesurera
  all / débloquées / aucune au banc (voir Pistes, Mémoire). Les faits du jeu viennent de Mineflayer ; la mémoire
  garde ce que l'agent SAIT (son expérience), jamais une copie des données du jeu.
- Le LLM ne voit qu'une partie des compétences (`SHOWN_TO_LLM`) : un petit modèle choisit mieux parmi peu d'options.
  Les textes montrés au LLM ne doivent pas renvoyer vers une compétence cachée.
- Toujours avoir `explore(direction, distance)` : sinon `block_not_found` bloque le LLM.
- Préférer peu de compétences génériques à beaucoup de spécifiques. Départ : 8 à 10, plafond visé : 20 à 30.
- Noms et signatures STABLES pour les données COLLECTÉES : les compétences sont des entrées du world model, renommer
  casse les données de collecte. Pendant le développement (données jetables), renommer ne pose aucun problème.
- Ne pas écrire de primitive trop restrictive (ex. `place` "à côté du bot") : utiliser des coordonnées dès le départ.
- Chaque compétence vérifie ses prérequis et renvoie une raison explicite
  (`missing_ingredients`, `no_tool`, `block_not_found`, `no_path`, `timeout`...) que le LLM peut exploiter.
- Qui gère un imprévu ? La COMPÉTENCE si c'est (1) dans sa promesse (collect_block = casser ET ramasser),
  (2) sans vrai choix dépendant du but (un joueur compétent n'y réfléchirait pas), (3) local, court et borné.
  La TACTIQUE (`recovery.py`) pour une réaction connue à un échec, écrite en suite de primitives. Le LLM dès qu'il
  y a un arbitrage ou des conséquences (dépenser, casser du précieux, risquer, choisir entre options).
  Ce que la compétence fait en plus se VOIT dans `details` et reste borné.
- Une politique générale, pas une règle par situation : ce qui peut être cassé en passant, ce qui est dangereux,
  vit une seule fois dans `movements.js` et toutes les compétences en héritent. Chercher la cause générale
  (ex. `not_collected` : pas « les feuilles », mais une cible qui BOUGE -> viser où l'objet atterrit).
  Seules exceptions : quelques instincts de sécurité (lave, chutes).
- Les FAITS du jeu viennent du jeu, pas de listes écrites par nous : données de Mineflayer (dureté, outils,
  recettes) et tags du serveur (`src/tags.js` : ce qui est remplaçable, les feuilles, les lits...). Nos listes
  ne gardent que nos CHOIX (ce qu'on protège, ce qu'on évite, les blocs jetables, ce qu'on signale au LLM).
  Un tag n'est pas toujours toute la règle : la neige est « remplaçable » mais le jeu n'en remplace qu'UNE
  couche ; on essaie, et la vérification après coup le dit (cas d'arène).
- Partage avec les têtes apprises de l'architecture hybride : le corps EXÉCUTE la mécanique (comment), le world
  model et les autres têtes CHOISISSENT (quand, quoi, quelle réaction). Les frictions de bas niveau se corrigent
  dans les compétences, pas en attendant un modèle plus fort : des compétences fiables rendent tous les modèles
  meilleurs, et donnent des données propres aux têtes apprises.
- Paramètres par défaut pensés pour le cas courant : `move_to` range 2 (on veut rarement être pile sur un bloc ;
  une cible pleine = s'arrêter à côté) ; la précision reste possible (range 0 ou 1).
- Contrôle d'expressivité : une liste de tâches variées (abri 3x3, planter du blé, tuer et cuire une vache,
  ranger dans un coffre, traverser un ravin) doit pouvoir s'écrire comme suite de primitives.
  Une tâche inexprimable = il manque une primitive.

## LLM et boucle de décision
- Chaque compétence est un OUTIL déclaré au LLM ; les appels d'une réponse, dans l'ordre, forment le plan.
  Deux outils en plus : `goal_reached` et `missing_capability` (ce dont il aurait eu besoin).
- Condition de but (`brain/goal.py`) : avant la boucle, un appel séparé à un seul outil `define_goal(item, count)`
  traduit le but en DONNÉES (`{"have": {"oak_log": 3}}`) ; le code la vérifie à chaque état, affiche
  « Goal progress », termine l'épisode (`condition_met`) et refuse un `goal_reached` trop tôt. Sans condition
  (« construis un abri ») : `goal_reached` comme avant. `--no-condition` (agent, banc) pour comparer.
  Arguments PLATS : avec un objet imbriqué, qwen2.5:3b fermait mal les accolades et Ollama jetait l'appel.
- Essayé puis RETIRÉ : demander une ou deux phrases de réflexion avant les appels (`--reasoning`). Sans effet
  sur llama3.1:8b, et qwen2.5:14b écrivait alors ses appels en TEXTE (0 compétence en 10 tours ; 3/3 sans).
  Le texte qu'un modèle écrit de lui-même à côté des appels n'est pas remis dans l'historique : les modèles de
  prompt d'Ollama ne savent pas montrer texte ET appels (llama3.1 jette le texte, qwen2.5 jette les APPELS).
  qwen2.5:14b l'écrit parfois en russe : sans effet, on ne le lit pas. Réponses bornées à `LLM_MAX_TOKENS` (600). Les sous-buts écrits par le LLM (`add_step`) ont été discutés et mis de côté.
  Les noms d'objets ne sont pas vérifiés (pas de liste dans Python) : erreur vue, « cook a beef » -> `beef`.
  (Avant : un seul outil `propose_plans` contenant une liste de compétences ; qwen2.5:3b appelait les compétences
  directement, Ollama jetait ces appels à des outils inconnus -> réponses vides.)
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
- À terme, le prompt est une VUE CONSTRUITE à chaque tour par `render.py` (but, état, faits utiles de la mémoire,
  prédictions du world model, dernier résultat, une ligne par tour passé), pas une conversation qui s'allonge :
  contexte borné par construction. Aujourd'hui c'est encore une conversation (suffisant : ~60 tours en 16k).
- Chaque bloc de la vue = un composant ajouté UN à la fois et mesuré sur le banc d'épisodes (avec/sans).
- Les correctifs de prompt pour un petit modèle (`NEXT_STEP`, formulation de `goal_reached`, premier essai gratuit)
  sont des rustines mesurées, pas de l'architecture : à remettre en cause si le modèle ou la forme du prompt change.
- Pistes plus tard, selon les mesures : historique résumé par le code, récupération d'expériences passées (précurseur
  des macros), fine-tuning du petit modèle sur des données de COLLECTE (A/B avec le world model). Le prompt caching
  n'agrandit pas la mémoire : il accélère, à condition de garder le début du prompt stable (rien qui change dans le
  prompt système).

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
  Pas de RAG, LangChain ni LangGraph. Sortie du LLM non contrainte pour l'instant (outils + JSON de secours dans le texte).

## Feuille de route (mise à jour)
5. Compétences : primitives générales d'abord, puis raccourcis, puis questions et exploration.
   [fait : move_to, break_block, pick_up, place_block, craft, eat, find, scan, explore, collect_block, mine ;
    lot 2 : attack, equip, use_item, container, smelt, wait]
6. Agent LLM baseline avec le champ `missing_capability` ; mesurer où il échoue.
   Le LLM prend directement les sorties de Node (pas encore de world model) : c'est la baseline de l'étape 8.
   [en cours : banc d'épisodes, condition de but ; tâches plus longues à ajouter (crafting_table, pioche)]
7. World model supervisé sur le journal.
8. Brancher le world model comme filtre, test A/B (avec/sans), et comparer petit/gros modèle.

### Pistes au-delà de l'étape 8 (projet long : liste OUVERTE, l'ordre est décidé par les mesures)
Vue d'ensemble et ordre des étapes : `docs/architecture.md` (cette liste garde le détail des idées).
Règle commune : un composant à la fois, mesuré avec/sans sur les bancs ; un composant appris s'AJOUTE (comprendre,
prédire, choisir) et ne remplace pas une compétence déterministe fiable. Les idées ci-dessous sont des directions,
pas des engagements ; en ajouter, en retirer selon ce que montrent les données.
- Autonomie :
  - déclencheurs (faim, santé, inventaire plein, monstre) : un réflexe Node interrompt la compétence et réveille le
    cerveau avec un message d'alerte ;
  - générateur de buts à priorités type pyramide de Maslow (survivre > manger > s'abriter > s'outiller > explorer),
    écrit en DONNÉES/règles dont le LLM se sert ; but long terme (« un château ») gardé en mémoire.
- Mémoire, par étapes :
  - historique résumé par le code, puis prompt = vue construite (voir « Architecture cognitive ») ;
  - mémoire de faits tenue par le code (lieux, coffres et contenu, zones explorées), mise à jour automatiquement
    depuis les résultats des compétences ;
  - plus tard : graphe de faits (GraphRAG : base -> coffre -> contenu -> position), base vectorielle pour les
    souvenirs et leçons, mémoire gérée par le LLM (type MemGPT : outils remember/recall) avec un modèle assez fort,
    « compression du soir » (un LLM relit le journal du jour et écrit des leçons, type Reflexion) ;
  - récupération d'expériences passées (plans réussis pour un but proche), précurseur des macros ;
  - connaissance du jeu filtrée par l'expérience : recettes « débloquées » (vues ou fabriquées) au lieu de toutes,
    pour mesurer ce que le livre de recettes complet apporte (réglage all / débloquées / aucune).
- Apprentissage sur le journal (données de COLLECTE uniquement, jamais dev) :
  - têtes supervisées (succès, durée, danger, delta d'inventaire) = étape 7, comparées aux baselines triviales ;
  - réétiquetage a posteriori (hindsight, cf. STEVE-1) : étiqueter un épisode par ce qu'il a VRAIMENT accompli ;
  - labeling : décrire les changements (deltas) en phrases, par gabarits puis paraphrases d'un LLM local, pour
    obtenir des paires (texte, changement) ; contrôler un échantillon à la main ;
  - alignement contrastif texte <-> changement (InfoNCE, encodeur de texte pré-entraîné figé + encodeur d'état
    appris) : la voie vers l'espace latent partagé ; la paire porte sur le CHANGEMENT, pas l'état final ; comparé
    à la baseline symbolique `define_goal` ;
  - encodeur d'état partagé, puis prédiction dans l'espace latent (JEPA : encodeur cible à mise à jour lente,
    surveiller l'effondrement) quand l'état grossit (grandes grilles, pixels) ;
  - fine-tuning (LoRA) du petit LLM sur des épisodes réussis, distillation depuis un gros modèle ; A/B avec le
    world model et les deux ensemble.
- Données : mélanger épisodes LLM, curriculums scriptés (bancs), exploration au hasard (un bot purement aléatoire
  n'atteint pas les états intéressants) ; plusieurs bots en parallèle ; compter ~300 transitions/heure/bot.
- Planification : macros enregistrées par le LLM (DONNÉES, mini-langage si besoin), planificateur sur le world
  model (moins d'appels LLM), contrôleur appris pour la tactique.
- Plus tard encore : multi-bots et rôles, voix, pixels (JEPA visuel ; politique type STEVE-1 comme UNE compétence
  de plus, `act(consigne)`, enveloppée comme les autres), RL sur un comportement qui plafonne.

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
- Banc d'épisodes (`brain/bench.py`) en place : succès vérifié sur l'état, lieux toujours neufs (le monde est
  persistant : un lieu rejoué a perdu ses arbres), `--compare`. oak_logs (3 lieux, seed 1, 20/10/2026) :
  llama3.1:8b 3/3 (1-2 tours, choisit `mine`) ; qwen2.5:3b 3/3 avec condition (2, 2, 8 tours), 3/3 sans (3, 7, 7).
  Trop peu de lieux pour conclure ; la tâche n'est plus discriminante.
- MESURE DU PLAFOND (crafting_table, seed 3, 21/10/2026) : qwen2.5:14b 3/3 (3 à 5 tours, ~1 min 30 par épisode :
  recipe -> mine -> planches -> table, bouleau choisi seul quand il n'y a que ça) ; llama3.1:8b 0/7 et qwen2.5:3b
  échouaient (craft de la table sans jamais faire les planches). Conclusion : l'architecture (compétences,
  `recipe` à un niveau, condition de but) suffit à un modèle assez fort ; les échecs des petits modèles viennent
  de leur taille. On ne règle plus le prompt pour eux : leurs échecs sont la référence que le world model doit
  améliorer (étape 8). Le 14B tient sur le M2 16 Go avec le serveur (contexte 16k).
- Corrigé cette session : nombres écrits en texte par Llama ("3"), condition de but (`goal.py`), `move_to` range 2
  par défaut, ramassage qui vise où l'objet ATTERRIT (`landingSpot` : cause de `not_collected`), "Digging aborted"
  en `dig_failed`, `cleared` remonté par collect_block et mine. Arène : move_to, break_block, collect_block,
  pick_up, mine passent ; `not_collected` n'a plus de cas d'arène (aucun montage déterministe trouvé).
- Prochaines étapes, dans l'ordre :
  1. Préparer la collecte pour le world model (étape 7) : commit, `MC_DATA_PURPOSE=collection`, bancs lancés en
     série (qwen2.5:14b pour des épisodes réussis variés, petits modèles pour des échecs), puis premières têtes.
  2. Banc terrain : case libre pour place_block, puis 50 lieux sur une nouvelle graine.
     Tâches plus longues au banc d'épisodes (wooden_pickaxe), ~10 lieux par variante.
  3. Options de stratégie pour `move_to`/`explore` (`dig`, `build`, `max_drop`, `avoid_water`), primitive courte
     `step(direction, count)`, réflexe de déblocage générique.
  4. `brain/recovery.py` (règles), mesuré sur le banc avec/sans.
  Petites corrections en attente : `context_length` non enregistré quand Ollama n'a pas encore chargé le modèle ;
  une réponse inutilisable rejouée à l'identique (température basse, graine fixe : le message de correction ne
  change rien) ; un `llm_error` (ex. modèle introuvable) compte comme un lieu joué au banc.
- Corrigé aussi : `mine` cherchait à 32 blocs et `find` à 64 (block_not_found alors qu'une bûche était à 42) ;
  banc d'épisodes : 100 tirages sur ±5000 blocs (les lieux joués sautés laissaient en tête les océans), un
  océan refusé par le serveur échoue tout de suite (`setup.js`).
- Compétences revues avant de figer (21/10/2026) : `place_block` accepte ce que le jeu remplace (tag
  replaceable ET sans boîte de collision : herbe oui, fleurs et neige épaisse non) ; `break_block` a
  `require_tool` (true par défaut ; false = casser sans l'outil, `no_drop`) ; `find`/`mine` acceptent un groupe
  du jeu (`#logs`) ; fin du temps limite unique de 60 s (voir Conventions : budget, progrès, alertes) ; `mine`
  plafonné par son budget (marche jusqu'au plus proche + ~5 s par bloc : ~18 blocs par appel). À décider : `explore` (max 256 -> 64 ?).
  Arène après ces changements (21/10/2026) : toutes les suites passent (règles d'arrêt, tags, place_block).
- `observe` revu (journal v8) : il garde TOUT ce que le client sait (le serveur envoie les blocs derrière les
  murs) et MARQUE ce que le bot voit (ligne de vue dans toutes les directions : masque de la grille, `visible`
  des entités). La perception = un masque sur la même ligne, pas un second format. Ajoutés : état des blocs,
  objets au sol, bloc visé, vitesse/regard/objet tenu/nom des entités (pas leur santé), accroupi, sprint,
  chute, XP, enchantements, biome, `perception`. Retirés : `block_below`, `block_front` (recalculables),
  `notable_blocks` (vu à travers les murs), remplacé par `in_sight` : TOUS les types de blocs EN VUE à moins de
  32 blocs, sans liste, par un éventail de ~18 000 rayons depuis les yeux (1,5° : un bloc à 32 blocs fait
  ~1,8°), arrêtés au premier bloc opaque, comme un écran. Même calcul pour `scan` et le masque de la grille.
  Notre DDA lit les chunks directement (~3x plus vite que le raycast de Mineflayer) ; 97 ms la première fois,
  4 ms en cache (yeux immobiles, aucun bloc changé), x-ray 218 ms. Affiché au LLM (« In sight: », tous les types : une limite coupait les arbres).
  Sans lui, le 14B cherchait du chêne dans une forêt d'épicéas (1/4 au lieu de 3/3).
- Banc crafting_table, qwen2.5:14b, ligne de vue (21/10/2026) : 4/4 avec « In sight » (sight 2/2, x-ray 2/2),
  puis 3/4 avec `#planks`/`uses`/`craftable` (2 forêts d'épicéas réussies du premier coup via `recipe("#planks")`).
  L'échec : un plan écrit d'avance autour du chêne, rejoué 10 fois avec `spruce_log` en vue à 4 blocs (a priori
  du modèle, pas un manque d'information : cas pour une tactique ou le world model). Le 14B enchaîne
  maintenant de longs plans (jusqu'à `goal_reached`) : jugé positif, la boucle arrête au premier échec. Hostile = catégorie du jeu « Hostile mobs ».
- Perception branchée (`src/perception.js`, `MC_PERCEPTION`, `POST /setup {perception}`) : `find`, `mine`
  (via find), `scan` et la vue du LLM ne voient que la ligne de vue par défaut ; `bench --xray`,
  `--compare sight`. Pas encore : la mémoire de ce qui a été vu ; le pathfinder planifie toujours avec tout
  ce que le client sait (mécanique du corps) ; l'alerte `hostile_near` compte aussi un monstre derrière un
  mur (un joueur l'entend). Grille : rayon 8 (17³ = 4913 cases, 11 Ko, +13 ms sur r5) ; au-delà, `in_sight` (32 blocs).
- Le script de rejeu d'un moment de décision (plusieurs graines, sans le jeu) est dans le scratchpad : à intégrer
  à `brain/` si on en refait l'usage.

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

