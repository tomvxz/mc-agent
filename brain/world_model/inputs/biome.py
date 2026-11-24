"""The biome under the feet -> indexes (embedded by the model) + yes/no facts of the game.

Decisions (2026-11-24): the name AND the category each get their own learned embedding (concatenated, in
the model), plus two booleans from the game data. The preprocessing only gives indexes: the embeddings
live in the model. Settings and reasons: variables.py, section "Biome".
"""

from pathlib import Path

from brain.world_model.inputs import game_data
from brain.world_model.inputs.variables import BIOME_SNOW_TEMPERATURE
from brain.world_model.inputs.vocabulary import VOCAB_DIR, vocabulary


def biome_vocabularies(version: str | None = None, directory: Path = VOCAB_DIR) -> tuple[list[str], list[str]]:
    """(names, categories): append-only vocabularies (vocabulary.py), grown with this game version's biomes.

    Built from the game, not from the data: a biome never seen in training still has its place.
    """
    table = game_data.biomes(version)
    names = vocabulary("biome_names", table, directory)
    categories = vocabulary("biome_categories", {b["category"] for b in table.values()}, directory)
    return names, categories


def biome_facts(entry: dict) -> dict[str, bool]:
    """The game's facts about one biome that matter here, as yes/no."""
    return {
        "biome_has_precipitation": bool(entry["has_precipitation"]),
        # Snow instead of rain. The threshold is in the game's code, not in minecraft-data
        "biome_snows": bool(entry["has_precipitation"]) and entry["temperature"] < BIOME_SNOW_TEMPERATURE,
    }


class BiomeEncoder:
    """Encodes the `biome` field of a state. Reads the game data once."""

    def __init__(self, version: str | None = None, directory: Path = VOCAB_DIR):
        self.table = game_data.biomes(version)
        self.names, self.categories = biome_vocabularies(version, directory)
        self._name_index = {n: i for i, n in enumerate(self.names)}
        self._category_index = {c: i for i, c in enumerate(self.categories)}

    def __call__(self, state: dict) -> dict[str, int]:
        """{biome_index, biome_category_index, biome_has_precipitation, biome_snows} (booleans as 0/1).

        A biome the body could not read (null) or that this game version does not know: UNKNOWN for both
        indexes, and 0 for the facts (the UNKNOWN index tells the model the facts are not real).
        """
        entry = self.table.get(state["biome"])
        if entry is None:
            return {"biome_index": 0, "biome_category_index": 0, "biome_has_precipitation": 0, "biome_snows": 0}
        return {
            "biome_index": self._name_index[entry["name"]],
            "biome_category_index": self._category_index[entry["category"]],
            **{k: int(v) for k, v in biome_facts(entry).items()},
        }
