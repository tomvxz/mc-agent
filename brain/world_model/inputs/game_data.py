"""Facts of the game, read from minecraft-data (the package Mineflayer uses, in bot/node_modules).

The game's version comes from MC_VERSION (the environment, else the .env file at the root): the same one
the body plays. dataPaths.json says, for each version, which folder holds each file (a file that did not
change is shared with an older version).
"""

import json
import os
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "bot" / "node_modules" / "minecraft-data" / "minecraft-data" / "data"


def mc_version() -> str:
    """The Minecraft version: MC_VERSION from the environment, else from the .env file."""
    if os.environ.get("MC_VERSION"):
        return os.environ["MC_VERSION"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "MC_VERSION" and value.strip():
                return value.strip()
    raise RuntimeError("MC_VERSION is not set (environment or .env)")


@cache
def game_file(name: str, version: str | None = None):
    """The content of one minecraft-data file (e.g. "biomes") for this version of the game."""
    version = version or mc_version()
    paths = json.loads((DATA_DIR / "dataPaths.json").read_text(encoding="utf-8"))["pc"]
    if version not in paths:
        raise ValueError(f"minecraft-data has no version {version}")
    if name not in paths[version]:
        raise ValueError(f"minecraft-data has no {name} for {version}")
    return json.loads((DATA_DIR / paths[version][name] / f"{name}.json").read_text(encoding="utf-8"))


def biomes(version: str | None = None) -> dict[str, dict]:
    """{name: the game's entry} for every biome: category, temperature, has_precipitation..."""
    return {b["name"]: b for b in game_file("biomes", version)}
