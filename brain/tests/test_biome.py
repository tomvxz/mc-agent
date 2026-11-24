"""The biome inputs (brain/world_model/inputs/biome.py), on the real game data of MC_VERSION."""

from brain.world_model.inputs.biome import BiomeEncoder, biome_vocabularies
from brain.world_model.inputs.variables import UNKNOWN

encode = BiomeEncoder()


def test_vocabularies_come_from_the_game():
    names, categories = biome_vocabularies()
    assert names[0] == categories[0] == UNKNOWN
    assert {"plains", "savanna", "nether_wastes", "the_end"} <= set(names)
    # the nether and the end are categories of their own: no need for the dimension
    assert {"nether", "the_end", "forest"} <= set(categories)
    assert len(names) == len(set(names)) and len(categories) == len(set(categories))


def test_a_known_biome():
    out = encode({"biome": "snowy_taiga"})
    assert encode.names[out["biome_index"]] == "snowy_taiga"
    assert encode.categories[out["biome_category_index"]] == "taiga"
    assert (out["biome_has_precipitation"], out["biome_snows"]) == (1, 1)


def test_rain_snow_or_nothing():
    assert (encode({"biome": "plains"})["biome_has_precipitation"], encode({"biome": "plains"})["biome_snows"]) == (1, 0)
    assert (encode({"biome": "desert"})["biome_has_precipitation"], encode({"biome": "desert"})["biome_snows"]) == (0, 0)


def test_unknown_or_unreadable_biome():
    unknown = {"biome_index": 0, "biome_category_index": 0, "biome_has_precipitation": 0, "biome_snows": 0}
    assert encode({"biome": "not_a_biome"}) == unknown
    assert encode({"biome": None}) == unknown


def test_every_biome_of_the_trial_runs_is_known():
    seen = ["savanna", "forest", "jungle", "mangrove_swamp", "bamboo_jungle", "old_growth_birch_forest",
            "snowy_plains", "dark_forest", "sparse_jungle", "birch_forest", "flower_forest", "plains", "swamp",
            "beach", "cherry_grove", "desert", "windswept_savanna", "stony_shore", "frozen_river", "river",
            "grove", "windswept_forest"]
    assert all(encode({"biome": b})["biome_index"] != 0 for b in seen)
