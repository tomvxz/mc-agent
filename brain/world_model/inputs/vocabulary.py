"""Vocabularies: name -> index, for the learned embeddings. APPEND-ONLY, so an index never changes.

A trained model has one embedding row per index: if an index moved (a new biome inserted in the middle of
an alphabetical list), the model would read the wrong row. So each vocabulary is a file of the repository
(vocab/<name>.json, committed), written by this code, never by hand:
  - index 0 is UNKNOWN (a value outside the vocabulary, or null);
  - names of the game that are not in the file yet are added AT THE END (sorted among themselves);
  - a name the game no longer has keeps its place (unused).
A model trained with N entries stays valid: entries N and above are new rows, to add to its embedding.
"""

import json
from pathlib import Path

from brain.world_model.inputs.variables import UNKNOWN

VOCAB_DIR = Path(__file__).resolve().parent / "vocab"


def vocabulary(name: str, game_names, directory: Path = VOCAB_DIR) -> list[str]:
    """The vocabulary `name` (e.g. "biome_names"), grown with the names of the game it lacks.

    The file is rewritten only when something was added. Returns the list: its position = the index.
    """
    path = Path(directory) / f"{name}.json"
    words = json.loads(path.read_text(encoding="utf-8")) if path.exists() else [UNKNOWN]
    if not words or words[0] != UNKNOWN:
        raise ValueError(f"{path}: index 0 must be {UNKNOWN!r}")
    if len(words) != len(set(words)):
        raise ValueError(f"{path}: a name appears twice")
    new = sorted(set(game_names) - set(words))
    if new:
        words += new
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(words, indent=0) + "\n", encoding="utf-8")
    return words
