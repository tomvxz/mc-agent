// Description des compétences pour le cerveau (LLM) : à quoi elles servent, leurs paramètres
// (au format JSON Schema, directement utilisable pour déclarer des outils à un LLM) et leurs
// raisons d'échec. Servi par l'API (GET /skills).
// Changer un nom, un paramètre ou une raison = augmenter CATALOGUE_VERSION (les épisodes la notent).

const CATALOGUE_VERSION = 1

// Raisons possibles pour TOUTES les compétences (ajoutées par runSkill et execute)
const RAISONS_COMMUNES = {
    timeout: 'la compétence a dépassé sa limite de temps (60 s) et a été arrêtée',
    exception: 'erreur inattendue dans le code (details.error)',
    bad_result: 'la compétence a renvoyé un résultat mal formé (bug)',
    unknown_skill: "ce nom de compétence n'existe pas",
}

// Raisons des compétences qui se déplacent
const DEPLACEMENT = {
    no_path: 'aucun chemin possible (endroit enfermé, porte en fer...)',
    path_timeout: 'le calcul du chemin a pris trop de temps (trajet très long ou terrain compliqué)',
    interrupted: 'le déplacement a été interrompu',
}

const entier = (description) => ({ type: 'integer', description })
const nombre = (description) => ({ type: 'number', description })
const texte = (description) => ({ type: 'string', description })
const COORDS = { x: entier('coordonnée x du bloc'), y: entier('coordonnée y du bloc (hauteur)'), z: entier('coordonnée z du bloc') }

const CATALOGUE = {
    move_to: {
        kind: 'primitive',
        description: "Aller à une position. Le bot gère seul les obstacles : il saute, contourne, creuse un passage " +
            "en dernier recours et monte en posant de la terre ou de la cobblestone s'il en a. Il évite la lave, " +
            'les chutes de plus de 3 blocs et les monstres. details.blocks_placed et blocks_broken disent ce que le trajet a coûté.',
        parameters: {
            type: 'object',
            properties: {
                x: nombre('coordonnée x visée'), y: nombre('coordonnée y visée'), z: nombre('coordonnée z visée'),
                range: { type: 'number', description: 'distance acceptée autour de la cible', default: 1 },
            },
            required: ['x', 'y', 'z'],
        },
        reasons: { invalid_args: 'coordonnées manquantes ou pas des nombres', ...DEPLACEMENT, not_arrived: "le bot s'est arrêté loin de la cible" },
    },
    break_block: {
        kind: 'primitive',
        description: "Casser le bloc à une position et ramasser ce qui tombe. Le bot s'approche jusqu'à voir le bloc " +
            "et prend le meilleur outil de l'inventaire. details.collected dit ce qui a été récupéré (peut être vide).",
        parameters: { type: 'object', properties: { ...COORDS }, required: ['x', 'y', 'z'] },
        reasons: {
            invalid_args: 'coordonnées manquantes ou pas des entiers',
            not_loaded: "cette zone n'est pas chargée (trop loin)",
            nothing_to_break: "il n'y a que de l'air ou un liquide à cette position",
            unbreakable: 'bloc incassable (bedrock, barrière)',
            no_tool: "ce bloc exige un outil absent de l'inventaire (details.tools, ex. une pioche pour la pierre)",
            ...DEPLACEMENT,
            dig_failed: 'le bloc ne s\'est pas cassé',
        },
    },
    place_block: {
        kind: 'primitive',
        description: "Poser un bloc de l'inventaire à une position. La case doit être vide et toucher un bloc plein " +
            "(sol, mur...). Le bot s'approche tout seul.",
        parameters: {
            type: 'object',
            properties: { item: texte("nom du bloc à poser, ex. 'cobblestone'"), ...COORDS },
            required: ['item', 'x', 'y', 'z'],
        },
        reasons: {
            invalid_args: 'paramètres manquants ou coordonnées pas entières',
            unknown_block: "ce nom n'est pas un bloc",
            not_in_inventory: "le bloc n'est pas dans l'inventaire",
            not_loaded: "cette zone n'est pas chargée",
            occupied: 'la case visée est déjà occupée (details.current)',
            no_support: 'aucun bloc plein à côté de la case pour y coller le nouveau',
            ...DEPLACEMENT,
            place_failed: "le serveur a refusé la pose, ou le bloc n'est pas là ensuite",
        },
    },
    craft: {
        kind: 'primitive',
        description: "Fabriquer un objet avec l'inventaire. Les recettes 2x2 (planches, bâtons, table) se font partout ; " +
            "les recettes 3x3 (outils...) demandent une crafting_table à moins de 32 blocs, vers laquelle le bot va seul.",
        parameters: {
            type: 'object',
            properties: {
                item: texte("nom de l'objet, ex. 'oak_planks', 'stick', 'wooden_pickaxe'"),
                count: { type: 'integer', description: "nombre d'objets voulus", default: 1 },
            },
            required: ['item'],
        },
        reasons: {
            invalid_args: 'paramètres manquants ou count pas un entier >= 1',
            unknown_item: "ce nom n'est pas un objet",
            no_recipe: "cet objet ne se fabrique pas (il se trouve ou s'obtient autrement)",
            missing_ingredients: "il manque des ingrédients dans l'inventaire",
            no_crafting_table: 'la recette demande une crafting_table et il n\'y en a pas à moins de 32 blocs',
            ...DEPLACEMENT,
            craft_failed: "la fabrication n'a rien donné",
        },
    },
    eat: {
        kind: 'primitive',
        description: "Manger pour remonter la faim (food, sur 20). Sans paramètre, choisit la nourriture la plus " +
            'nourrissante et évite celles qui rendent malade.',
        parameters: { type: 'object', properties: { food: texte("nourriture précise à manger, ex. 'bread' (facultatif)") } },
        reasons: {
            invalid_args: 'food n\'est pas un texte',
            unknown_item: "ce nom n'est pas une nourriture",
            not_hungry: 'la faim est déjà pleine (20) : impossible de manger',
            no_food: "aucune nourriture (mangeable sans danger) dans l'inventaire",
            eat_failed: "le bot n'a pas réussi à manger, ou la faim n'a pas remonté",
        },
    },
    find: {
        kind: 'question',
        description: 'Trouver les blocs ou entités les plus proches (ne change rien au monde). target : un nom de bloc ' +
            "('oak_log'), d'entité ('cow') ou 'hostile' pour tous les monstres. Ne voit que les zones chargées autour du bot. " +
            'details.matches est trié du plus proche au plus loin.',
        parameters: {
            type: 'object',
            properties: {
                target: texte("nom de bloc, nom d'entité, ou 'hostile'"),
                count: { type: 'integer', description: 'nombre maximum de résultats (1 à 50)', default: 5 },
                max_distance: { type: 'number', description: 'distance maximale de recherche (64 au plus)', default: 64 },
            },
            required: ['target'],
        },
        reasons: {
            invalid_args: 'target manquant, ou count / max_distance hors limites',
            unknown_target: "ce nom n'est ni un bloc, ni une entité, ni 'hostile'",
            not_found: 'rien de tel à portée : essayer explore puis recommencer',
        },
    },
    scan: {
        kind: 'question',
        description: 'Résumé de ce qui entoure le bot (ne change rien au monde) : bûches, minerais, eau, lave, ' +
            'crafting_table, four, coffre, sable, gravier, argile, et toutes les entités, avec leur nombre et la position la plus proche.',
        parameters: { type: 'object', properties: { radius: { type: 'number', description: 'rayon en blocs (32 au plus)', default: 16 } } },
        reasons: { invalid_args: 'rayon invalide (doit être entre 0 et 32)' },
    },
    explore: {
        kind: 'primitive',
        description: "Partir dans une direction pour découvrir de nouveaux endroits, par exemple quand find ne trouve rien. " +
            'Nord = -z, sud = +z, est = +x, ouest = -x. details.traveled donne la distance réellement parcourue.',
        parameters: {
            type: 'object',
            properties: {
                direction: {
                    type: 'string',
                    enum: ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west'],
                },
                distance: { type: 'number', description: 'distance à parcourir (256 au plus)', default: 32 },
            },
            required: ['direction'],
        },
        reasons: { invalid_args: 'direction inconnue ou distance invalide', ...DEPLACEMENT },
    },
    mine: {
        kind: 'shortcut',
        description: "Raccourci : récupérer `count` blocs d'un type (find puis break_block, répété). Passe aux blocs " +
            "suivants si l'un est inaccessible. Réussit seulement si les objets sont dans l'inventaire.",
        parameters: {
            type: 'object',
            properties: {
                block: texte("nom du bloc, ex. 'oak_log'"),
                count: { type: 'integer', description: 'nombre de blocs', default: 1 },
            },
            required: ['block'],
        },
        reasons: {
            unknown_block: "ce nom n'est pas un bloc",
            invalid_args: 'count pas un entier >= 1',
            block_not_found: 'aucun bloc de ce type à moins de 32 blocs : essayer explore',
            partial: 'moins de blocs que demandé (details.dug)',
            no_path: 'des blocs existent mais aucun n\'est accessible',
            no_tool: 'ce bloc exige un outil (details.tools)',
            unbreakable: 'bloc incassable',
            not_loaded: "zone non chargée",
            dig_failed: 'un bloc ne s\'est pas cassé',
            not_collected: 'blocs cassés mais objets non récupérés',
        },
    },
}

module.exports = { CATALOGUE, CATALOGUE_VERSION, RAISONS_COMMUNES }
