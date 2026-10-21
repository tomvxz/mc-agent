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
    "craftable",
    "place_block",
    "explore",
];

// Reasons possible for EVERY skill (added by runSkill and execute)
const COMMON_REASONS = {
    timeout:
        "the skill took much longer than expected and was stopped (details.seconds); details.inventory_change: " +
        "what it had gathered or used before being stopped",
    no_progress:
        "the skill was stopped: nothing moved, was dug or changed in the inventory for 15 s; " +
        "details.inventory_change: what it had done before",
    alert:
        "the skill was stopped because the bot was hurt or a monster came close (details.trigger): " +
        "decide what to do first; details.inventory_change: what it had done before",
    too_long:
        "refused before starting: it would take too long (details.estimated_seconds, more than details.max_seconds), " +
        "e.g. too many blocks at once: split it into several calls",
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
            properties: {
                ...COORDS,
                require_tool: {
                    type: "boolean",
                    description:
                        "true: refuse a block that drops nothing without the right tool (stone without a pickaxe). " +
                        "false: break it anyway to clear a way, slower, nothing drops (details.no_drop)",
                    default: true,
                },
            },
            required: ["x", "y", "z"],
        },
        reasons: {
            invalid_args: "missing coordinates or not integers, or require_tool not true/false",
            not_loaded: "this area is not loaded (too far)",
            nothing_to_break: "there is only air or a liquid at this position",
            unbreakable: "unbreakable block (bedrock, barrier)",
            no_tool:
                "this block requires a tool missing from the inventory (details.tools, e.g. a pickaxe for stone); " +
                "require_tool false breaks it anyway, without drop",
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
            "Place a block from the inventory at a position. The cell must be free (air, or what the game replaces: " +
            "grass, ferns, water, one layer of snow; not flowers) and touch a solid block " +
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
                "some ingredients are missing (details.ingredients: the item, or one_of = any one of these items, " +
                "with required and owned counts); recipe tells what an ingredient is made of",
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
            "The recipe book (changes nothing in the world), one level, both ways. item: what it is crafted from: the " +
            "ingredients of one craft (details.ingredients: the item, or one_of = any one of these items, with group = " +
            "the game's group of them, e.g. '#planks'), how many items it makes, whether a crafting_table is needed. " +
            "item can be a group ('#planks'): the recipe of each of its items. uses: what is crafted directly FROM an " +
            "item or a group (e.g. 'birch_log', '#logs'). Ask again for the next level. Crafting only, not smelting.",
        parameters: {
            type: "object",
            properties: {
                item: string("item or group to craft, e.g. 'crafting_table', '#planks'"),
                uses: string("instead of item: an item or group to craft FROM, e.g. 'birch_log'"),
            },
            required: [],
        },
        reasons: {
            invalid_args: "give item or uses (one of them, a name)",
            unknown_item: "this name is neither an item nor a game group of items",
            no_recipe: "this item cannot be crafted: it is gathered or obtained some other way",
            no_use: "nothing is crafted directly from it",
        },
    },
    craftable: {
        kind: "question",
        description:
            "What can be crafted NOW with the inventory, like the recipe book's 'craftable' filter (changes nothing " +
            "in the world): details.now (in the inventory's 2x2 grid), details.with_table (needs a crafting_table; " +
            "table_near: one within 32 blocks), with how many items one craft makes.",
        parameters: { type: "object", properties: {}, required: [] },
        reasons: { nothing_craftable: "the inventory allows no craft at all, even with a table (details.table_near)" },
    },
    find: {
        kind: "question",
        description:
            "Find the nearest blocks or entities (changes nothing in the world). target: a block name " +
            "('oak_log'), a game group of blocks starting with # ('#logs' = any log, '#iron_ores'; details.matches " +
            "then say which block), an entity name ('cow') or 'hostile' for every monster. Only sees the loaded area around the bot. " +
            "details.matches is sorted nearest first.",
        parameters: {
            type: "object",
            properties: {
                target: string("block name, game group of blocks ('#logs'), entity name, or 'hostile'"),
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
            unknown_target: "this name is neither a block, nor a game group of blocks, nor an entity, nor 'hostile'",
            not_found: "nothing like that in range: try explore, then search again",
        },
    },
    scan: {
        kind: "question",
        description:
            "Summary of what the bot sees around it (changes nothing in the world): every kind of block in sight " +
            "and every entity in sight, with their count and the nearest position.",
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
    walk: {
        kind: "low_level",
        description:
            "Walk STRAIGHT a few blocks in a direction, without searching a path: jumps up one-block steps, " +
            "stops in front of a wall, a drop of more than 3 blocks, water or lava. A short way out when " +
            "move_to is stuck. yaw in radians, as in the state: 0 = north (-z), pi/2 = west, -pi/2 = east, pi = south.",
        parameters: {
            type: "object",
            properties: {
                yaw: number("direction in radians (0 = north, pi/2 = west)"),
                distance: { type: "number", description: "blocks to walk (8 at most)", default: 1 },
            },
            required: ["yaw"],
        },
        reasons: {
            invalid_args: "yaw is not a number, or distance not between 0 and 8",
            blocked: "a wall (details.obstacle) or something that stops the bot is in the way",
            danger_ahead: "lava, water, a drop of more than 3 blocks or an unloaded area ahead (details.danger)",
        },
    },
    look: {
        kind: "low_level",
        description:
            "Turn the head: yaw and pitch in radians, as in the state (yaw 0 = north, pi/2 = west; pitch 0 = level, " +
            "positive = up). Sets the direction of press.",
        parameters: {
            type: "object",
            properties: {
                yaw: number("horizontal angle in radians"),
                pitch: { type: "number", description: "vertical angle in radians, -pi/2 to pi/2", default: 0 },
            },
            required: ["yaw"],
        },
        reasons: { invalid_args: "yaw or pitch is not a number, or pitch beyond pi/2" },
    },
    press: {
        kind: "low_level",
        description:
            "Hold keys for a number of game ticks (20 per second), then release them: forward, back, left, right " +
            "(relative to where the bot looks), jump, sprint, sneak. Raw input: no safety check (walk has them).",
        parameters: {
            type: "object",
            properties: {
                keys: {
                    type: "array",
                    items: { type: "string", enum: ["forward", "back", "left", "right", "jump", "sprint", "sneak"] },
                    description: "the keys held together",
                },
                ticks: { type: "integer", description: "how long, 1 to 40 ticks (2 s)", default: 10 },
            },
            required: ["keys"],
        },
        reasons: { invalid_args: "no keys, an unknown key, or ticks not between 1 and 40" },
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
                block: string("block name, e.g. 'oak_log', or a game group of blocks: '#logs' = any log"),
                count: { type: "integer", description: "number of blocks", default: 1 },
            },
            required: ["block"],
        },
        reasons: {
            unknown_block: "this name is neither a block nor a game group of blocks",
            invalid_args: "count is not an integer >= 1",
            block_not_found: "no block of this type within 64 blocks: try explore",
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
