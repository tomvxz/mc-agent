"""How each variable of the state is encoded: one table per transformation.

The single place that says what happens to a variable before the model sees it. To add a variable, put it
in the table of its transformation. The preprocessing (data_processing.py) reads these tables.

Missing values: a field is either REQUIRED (it must be in every state the code reads: if it is not, the
line is broken and that is a bug to look at, not something to hide), or listed in DEFAULTS (we know it can
be null, and why). Measured on the trial runs (2026-11-13, 2086 states, v10): only `oxygen` was ever null.
"""

import math

# Minecraft's height bounds (overworld)
DOWN_HEIGHT = -64
UP_HEIGHT = 319

# ---------------------------------------------------------------------------------------------------
# Transformations
# ---------------------------------------------------------------------------------------------------

# Divided by the game's maximum -> [0, 1]
SCALED = {
    "health": 20,
    "food": 20,
    "food_saturation": 20,
    "oxygen": 20,  # the bot's air, in bubbles (v11; v10 could hold another entity's air)
    "light": 15,  # block light (torches, lava): mostly 0 outside
    "sky_light": 15,
}

# Periodic -> (sin, cos): the end of the cycle is close to its start. Value: the period, in the field's unit
CYCLES = {
    "time_of_day": 24000,  # ticks, 0 = sunrise
    "moon_phase": 8,  # 0 = full moon
    "yaw": 2 * math.pi,  # radians (Mineflayer)
}

# Bounded -> [-1, 1] with (min, max)
BOUNDED = {
    "pitch": (
        -math.pi / 2,
        math.pi / 2,
    ),  # radians: looking straight down .. straight up
    "y": (
        DOWN_HEIGHT,
        UP_HEIGHT,
    ),  # position[1]: absolute y means something (sea level, ores); x and z do not
}

# Kept as they are (already small numbers)
RAW = ["vx", "vy", "vz", "fall_distance", "xp_level", "xp_progress", "xp_points"]

# Yes / no -> 0 or 1
BOOLS = [
    "on_ground",
    "in_water",
    "in_lava",
    "on_fire",
    "sneaking",
    "sprinting",
    "sleeping",
    "raining",
    "thunder",
]

# One of a few known values: kept as strings for now (how to encode them: decided later)
CATEGORIES = {
    "difficulty": ["peaceful", "easy", "normal", "hard"],
}

# Computed from other fields (the computation lives in data_processing.py)
DERIVED = {
    "free_slots": "share of the 36 storage slots (9-44) that are empty, from inventory_slots",
}

# ---------------------------------------------------------------------------------------------------
# Biome (biome.py): the biome under the feet
# ---------------------------------------------------------------------------------------------------

# Token for a value outside a vocabulary (never seen, not in this game version, or null)
UNKNOWN = "unknown"

# Learned embeddings (in the model, concatenated): field -> vocabulary. Vocabularies come from the GAME
# (minecraft-data biomes.json, 65 biomes and 19 categories in 1.21.11) + UNKNOWN at index 0, not from the
# data: on the trial runs only 22 biomes appear, very unevenly (savanna 473 states, windswept_forest 1).
# The category already separates the nether and the end (they have their own biomes): no `dimension`.
# Category "none" holds two unrelated biomes (pale_garden, the_void): the name embedding tells them apart.
BIOME_EMBEDDED = [
    "biome_index",
    "biome_category_index",
]

# Facts of the game, yes / no -> 0 or 1. Temperature itself barely matters: only whether it snows
BIOME_BOOLS = ["biome_has_precipitation", "biome_snows"]

# Below this temperature, precipitation falls as snow. In the game's CODE (not in minecraft-data), so
# written here. Limit: some mountain biomes also get snow above a height, which this does not see (y does)
BIOME_SNOW_TEMPERATURE = 0.15

# In training, the name index is replaced by UNKNOWN this often, so that the model learns to rely on the
# category and the facts: what it will have for a biome never seen in training
BIOME_UNKNOWN_RATE = 0.1

# ---------------------------------------------------------------------------------------------------
# Missing values
# ---------------------------------------------------------------------------------------------------

# Fields that can be null, with the value used instead. No flag: here null has a known meaning, so the
# default IS the real value. (A field that could not be READ would need a flag: none so far.)
DEFAULTS = {
    "oxygen": 20,  # null until the server first reports it (it only does when it changes: underwater) = full air
}

# ---------------------------------------------------------------------------------------------------
# The features, in the order of the vector (state_vector): every table above, aggregated
# ---------------------------------------------------------------------------------------------------

FEATURE_NAMES = [
    *SCALED,
    *(f"{side}_{key}" for key in CYCLES for side in ("sin", "cos")),
    *BOUNDED,
    *RAW,
    *BOOLS,
    *CATEGORIES,  # strings
    *DERIVED,
    *BIOME_EMBEDDED,  # indexes, not measures: each goes to its embedding in the model
    *BIOME_BOOLS,
]


# ---------------------------------------------------------------------------------------------------
# Not used (yet), and why
# ---------------------------------------------------------------------------------------------------

NOT_USED = {
    "perception": "how the line was observed, not a fact of the world",
    "position x, z": "absolute coordinates: the model would learn places (y is used)",
    "inventory, inventory_slots": "next step: tokens per item (only free_slots for now)",
    "held_slot, held_item, armor, off_hand": "next step, with the inventory tokens",
    "game_mode": "always survival so far",
    "dimension": "the biome's category already tells the nether and the end apart",
    "biome_id": "the game's number for the biome: changes between versions (the name is used)",
    "deaths, day": "history and run identity, not the present situation",
    "effects": "no effect on the current skills (later)",
    "looking_at, looking_at_entity": "only matters for the low-level skills (press)",
    "entities, in_sight, blocks": "next steps (sets, grid)",
}
