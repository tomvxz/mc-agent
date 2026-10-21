// Skill descriptions for the brain (LLM): what they are for, their parameters (as JSON Schema,
// directly usable to declare tools to an LLM) and their failure reasons. Served by the API (GET /skills).

// The skills shown to the LLM for now (GET /skills). A small model chooses better among fewer
// options; these are enough to gather wood and make a pickaxe (place_block puts the crafting table
// down). The others still work (tests, GET /skills?all=1): show them again when a goal needs them.
const SHOWN_TO_LLM = [
    "move_to",
    "find",
    "collect_block",
    "mine",
    "craft",
    "recipe",
    "place_block",
    "explore",
];

// Reasons possible for EVERY skill (added by runSkill and execute)
const COMMON_REASONS = {
    timeout:
        "the skill exceeded its time limit (60 s) and was stopped; details.inventory_change: what it had " +
        "gathered or used before being stopped",
    exception: "unexpected error in the code (details.error)",
    bad_result: "the skill returned a malformed result (bug)",
    unknown_skill: "no skill has this name",
};

// Reasons of the skills that move
const MOVEMENT = {
    no_path: "no path possible (enclosed place, iron door...)",
    path_timeout: "computing the path took too long (very long trip or complicated terrain)",
    interrupted: "the movement was interrupted",
    stuck: "the bot stopped making progress for 8 s (blocked somewhere): try another target or route",
};

const integer = (description) => ({ type: "integer", description });
const number = (description) => ({ type: "number", description });
const string = (description) => ({ type: "string", description });
const COORDS = {
    x: integer("x coordinate of the block"),
    y: integer("y coordinate of the block (height)"),
    z: integer("z coordinate of the block"),
};

const CATALOGUE = {
    move_to: {
        kind: "primitive",
        description:
            "Go to a position. The bot handles obstacles on its own: it jumps, goes around, digs a passage " +
            "as a last resort and pillars up with dirt or cobblestone if it has some. It avoids lava, falls higher " +
            "than 3 blocks and monsters. details.blocks_placed and blocks_broken tell what the trip cost. " +
            "With the default range it stops within 2 blocks, next to a block if the target is one; " +
            "range 0 or 1 to stand exactly at a free position.",
        parameters: {
            type: "object",
            properties: {
                x: number("target x coordinate"),
                y: number("target y coordinate"),
                z: number("target z coordinate"),
                range: {
                    type: "number",
                    description: "accepted distance around the target",
                    default: 2,
                },
            },
            required: ["x", "y", "z"],
        },
        reasons: {
            invalid_args: "missing coordinates or not numbers",
            target_blocked:
                "range below 2 but the target is inside a solid block (details.block): use range 2 to stand next to it; " +
                "to collect this block, use collect_block at these coordinates (or mine)",
            ...MOVEMENT,
            not_arrived: "the bot stopped far from the target",
        },
    },
    break_block: {
        kind: "primitive",
        description:
            "Break the block at a position, and only that (to also get its items, use collect_block). " +
            "No need to move_to first. The bot gets close enough to see the block " +
            "(if no place shows it, it breaks what hides it when that breaks almost instantly, like leaves) and uses the best tool in the inventory. " +
            "details.drops tells what fell on the ground (pick_up gets it), details.collected what came straight into the inventory.",
        parameters: {
            type: "object",
            properties: { ...COORDS },
            required: ["x", "y", "z"],
        },
        reasons: {
            invalid_args: "missing coordinates or not integers",
            not_loaded: "this area is not loaded (too far)",
            nothing_to_break: "there is only air or a liquid at this position",
            unbreakable: "unbreakable block (bedrock, barrier)",
            no_tool:
                "this block requires a tool missing from the inventory (details.tools, e.g. a pickaxe for stone)",
            ...MOVEMENT,
            dig_failed: "the block did not break",
        },
    },
    pick_up: {
        kind: "primitive",
        description:
            "Pick up the items lying on the ground near the bot: all of them, or only one type. " +
            "Useful after break_block, or when an animal or another player drops something. " +
            "details.collected tells what reached the inventory.",
        parameters: {
            type: "object",
            properties: {
                item: string("item name, e.g. 'oak_log' (optional: every item if absent)"),
                max_distance: {
                    type: "number",
                    description: "search radius around the bot (32 at most)",
                    default: 8,
                },
            },
            required: [],
        },
        reasons: {
            invalid_args: "item is not a string, or max_distance is not between 0 and 32",
            unknown_item: "this name is not an item",
            nothing_to_pick_up: "no item of this type on the ground within max_distance",
            ...MOVEMENT,
            not_collected: "the bot reached the items but they were not picked up",
            partial: "some items were picked up, others are still on the ground (details.left)",
        },
    },
    place_block: {
        kind: "primitive",
        description:
            "Place a block from the inventory at a position. The cell must be empty and touch a solid block " +
            "(floor, wall...). The bot walks there on its own.",
        parameters: {
            type: "object",
            properties: {
                item: string("name of the block to place, e.g. 'cobblestone'"),
                ...COORDS,
            },
            required: ["item", "x", "y", "z"],
        },
        reasons: {
            invalid_args: "missing parameters or non-integer coordinates",
            unknown_block: "this name is not a block",
            not_in_inventory: "the block is not in the inventory",
            not_loaded: "this area is not loaded",
            occupied: "the target cell is already occupied (details.current)",
            no_support: "no solid block next to the cell to attach the new one to",
            ...MOVEMENT,
            place_failed: "the server refused the placement, or the block is not there afterwards",
        },
    },
    craft: {
        kind: "primitive",
        description:
            "Craft an item from the inventory. 2x2 recipes (planks, sticks, table) work anywhere; " +
            "3x3 recipes (tools...) need a crafting_table within 32 blocks, which the bot walks to on its own.",
        parameters: {
            type: "object",
            properties: {
                item: string("item name, e.g. 'oak_planks', 'stick', 'wooden_pickaxe'"),
                count: {
                    type: "integer",
                    description: "number of items wanted",
                    default: 1,
                },
            },
            required: ["item"],
        },
        reasons: {
            invalid_args: "missing parameters or count not an integer >= 1",
            unknown_item: "this name is not an item",
            no_recipe: "this item cannot be crafted (it is found or obtained some other way)",
            missing_ingredients:
                "some ingredients are missing (details.ingredients: required and owned counts of each; any_X " +
                "means one of the items in one_of); recipe tells what an ingredient is made of",
            no_crafting_table:
                "the recipe needs a crafting_table and there is none within 32 blocks (details.ingredients: what it needs)",
            ...MOVEMENT,
            craft_failed: "crafting produced nothing",
        },
    },
    eat: {
        kind: "primitive",
        description:
            "Eat to restore hunger (food, out of 20). Without a parameter, picks the most nourishing food " +
            "and avoids the ones that make you sick.",
        parameters: {
            type: "object",
            properties: {
                food: string("specific food to eat, e.g. 'bread' (optional)"),
            },
        },
        reasons: {
            invalid_args: "food is not a string",
            unknown_item: "this name is not a food",
            not_hungry: "hunger is already full (20): eating is impossible",
            no_food: "no (safe) food in the inventory",
            eat_failed: "the bot could not eat, or hunger did not go up",
        },
    },
    recipe: {
        kind: "question",
        description:
            "Ask what an item is crafted from (changes nothing in the world): the ingredients of one craft " +
            "(details.ingredients; any_X means one of the items in one_of), how many items it makes, and whether " +
            "a crafting_table is needed. Only this item: ask again for an ingredient. Crafting only, not smelting.",
        parameters: {
            type: "object",
            properties: { item: string("item name, e.g. 'crafting_table', 'wooden_pickaxe'") },
            required: ["item"],
        },
        reasons: {
            invalid_args: "missing item",
            unknown_item: "this name is not an item",
            no_recipe: "this item cannot be crafted: it is gathered or obtained some other way",
        },
    },
    find: {
        kind: "question",
        description:
            "Find the nearest blocks or entities (changes nothing in the world). target: a block name " +
            "('oak_log'), an entity name ('cow') or 'hostile' for every monster. Only sees the loaded area around the bot. " +
            "details.matches is sorted nearest first.",
        parameters: {
            type: "object",
            properties: {
                target: string("block name, entity name, or 'hostile'"),
                count: {
                    type: "integer",
                    description: "maximum number of results (1 to 50)",
                    default: 5,
                },
                max_distance: {
                    type: "number",
                    description: "maximum search distance (64 at most)",
                    default: 64,
                },
            },
            required: ["target"],
        },
        reasons: {
            invalid_args: "missing target, or count / max_distance out of bounds",
            unknown_target: "this name is neither a block, nor an entity, nor 'hostile'",
            not_found: "nothing like that in range: try explore, then search again",
        },
    },
    scan: {
        kind: "question",
        description:
            "Summary of what surrounds the bot (changes nothing in the world): logs, ores, water, lava, " +
            "crafting_table, furnace, chest, sand, gravel, clay, and every entity, with their count and the nearest position.",
        parameters: {
            type: "object",
            properties: {
                radius: {
                    type: "number",
                    description: "radius in blocks (32 at most)",
                    default: 16,
                },
            },
        },
        reasons: { invalid_args: "invalid radius (must be between 0 and 32)" },
    },
    explore: {
        kind: "primitive",
        description:
            "Head in a direction to discover new places, for example when find finds nothing. " +
            "North = -z, south = +z, east = +x, west = -x. details.traveled gives the distance actually covered.",
        parameters: {
            type: "object",
            properties: {
                direction: {
                    type: "string",
                    enum: [
                        "north",
                        "south",
                        "east",
                        "west",
                        "north_east",
                        "north_west",
                        "south_east",
                        "south_west",
                    ],
                },
                distance: {
                    type: "number",
                    description: "distance to cover (256 at most)",
                    default: 32,
                },
            },
            required: ["direction"],
        },
        reasons: {
            invalid_args: "unknown direction or invalid distance",
            ...MOVEMENT,
        },
    },
    collect_block: {
        kind: "shortcut",
        description:
            "Use it to collect one specific block whose position you know (from find): it breaks the block " +
            "and picks up what drops. No need to move_to first. " +
            "details.collected tells what reached the inventory (may be empty: leaves or glass drop nothing).",
        parameters: {
            type: "object",
            properties: { ...COORDS },
            required: ["x", "y", "z"],
        },
        reasons: {
            invalid_args: "missing coordinates or not integers",
            not_loaded: "this area is not loaded (too far)",
            nothing_to_break: "there is only air or a liquid at this position",
            unbreakable: "unbreakable block (bedrock, barrier)",
            no_tool:
                "this block requires a tool missing from the inventory (details.tools, e.g. a pickaxe for stone)",
            ...MOVEMENT,
            dig_failed: "the block did not break",
            not_collected: "the block broke but its items fell out of reach (details.drops)",
        },
    },
    mine: {
        kind: "shortcut",
        description:
            "Use it to gather resources (wood, stone, ore...): it walks to the nearest blocks of that type, " +
            "breaks them and picks up the items, no need to find or move_to first. " +
            "Moves on to other blocks if one is unreachable. Only succeeds if the items are in the inventory.",
        parameters: {
            type: "object",
            properties: {
                block: string("block name, e.g. 'oak_log'"),
                count: { type: "integer", description: "number of blocks", default: 1 },
            },
            required: ["block"],
        },
        reasons: {
            unknown_block: "this name is not a block",
            invalid_args: "count is not an integer >= 1",
            block_not_found: "no block of this type within 32 blocks: try explore",
            partial: "fewer blocks than requested (details.dug)",
            no_path: "blocks exist but none is reachable",
            no_tool: "this block requires a tool (details.tools)",
            unbreakable: "unbreakable block",
            not_loaded: "area not loaded",
            dig_failed: "a block did not break",
            not_collected: "blocks broken but items not picked up",
        },
    },
};

// The arguments as the skill really uses them: the requested ones + the declared defaults
// (e.g. mine({ block }) really means { block, count: 1 }). Recorded as skill.args_resolved.
function resolveArgs(name, args) {
    const entry = Object.hasOwn(CATALOGUE, name) ? CATALOGUE[name] : null;
    if (!entry || typeof args !== "object" || args === null) return args;
    const defaults = {};
    for (const [param, schema] of Object.entries(entry.parameters.properties)) {
        if (schema.default !== undefined) defaults[param] = schema.default;
    }
    return { ...defaults, ...args };
}

export { CATALOGUE, COMMON_REASONS, resolveArgs, SHOWN_TO_LLM };
