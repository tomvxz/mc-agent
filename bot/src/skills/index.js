import break_block from "./break_block.js";
import craft from "./craft.js";
import eat from "./eat.js";
import explore from "./explore.js";
import find from "./find.js";
import mine from "./mine.js";
import move_to from "./move_to.js";
import place_block from "./place_block.js";
import scan from "./scan.js";

// The skill catalogue. NAMES are stable: they are inputs of the world model.
export default {
  // Primitives (act on the world)
  move_to,
  break_block,
  place_block,
  craft,
  eat,
  // Questions (change nothing in the world)
  find,
  scan,
  // Moving to discover new places
  explore,
  // Shortcuts (assemblies of primitives)
  mine,
};
