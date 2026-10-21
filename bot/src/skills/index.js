import break_block from "./break_block.js";
import collect_block from "./collect_block.js";
import craft from "./craft.js";
import craftable from "./craftable.js";
import eat from "./eat.js";
import explore from "./explore.js";
import find from "./find.js";
import look from "./look.js";
import mine from "./mine.js";
import move_to from "./move_to.js";
import pick_up from "./pick_up.js";
import place_block from "./place_block.js";
import press from "./press.js";
import recipe from "./recipe.js";
import scan from "./scan.js";
import walk from "./walk.js";

// The skill catalogue. NAMES are stable: they are inputs of the world model.
export default {
  // Primitives (act on the world)
  move_to,
  break_block,
  place_block,
  pick_up,
  craft,
  eat,
  // Questions (change nothing in the world)
  find,
  scan,
  recipe,
  craftable,
  // Moving to discover new places
  explore,
  // Shortcuts (assemblies of primitives)
  collect_block,
  mine,
  // Low level (no pathfinder): a short way out, varied movements for the data, a future learned controller
  walk,
  look,
  press,
};
