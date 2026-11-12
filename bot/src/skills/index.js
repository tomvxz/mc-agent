import break_block from "./actions/break_block.js";
import collect_block from "./shortcuts/collect_block.js";
import craft from "./actions/craft.js";
import craftable from "./questions/craftable.js";
import dig from "./actions/dig.js";
import eat from "./actions/eat.js";
import explore from "./actions/explore.js";
import find from "./questions/find.js";
import look from "./low_level/look.js";
import mine from "./shortcuts/mine.js";
import move_to from "./actions/move_to.js";
import pick_up from "./actions/pick_up.js";
import place_block from "./actions/place_block.js";
import press from "./low_level/press.js";
import recipe from "./questions/recipe.js";
import scan from "./questions/scan.js";
import strip_mine from "./shortcuts/strip_mine.js";
import walk from "./low_level/walk.js";

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
  // Moving to discover new places (dig: underground, uncovering what is hidden)
  explore,
  dig,
  // Shortcuts (assemblies of primitives)
  collect_block,
  mine,
  strip_mine,
  // Low level (no pathfinder): a short way out, varied movements for the data, a future learned controller
  walk,
  look,
  press,
};
