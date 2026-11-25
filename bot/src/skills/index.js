import break_block from "./actions/break_block.js";
import craft from "./actions/craft.js";
import dig from "./actions/dig.js";
import eat from "./actions/eat.js";
import explore from "./actions/explore.js";
import move_to from "./actions/move_to.js";
import pick_up from "./actions/pick_up.js";
import place_block from "./actions/place_block.js";
import look from "./low_level/look.js";
import press from "./low_level/press.js";
import walk from "./low_level/walk.js";
import craftable from "./questions/craftable.js";
import find from "./questions/find.js";
import recipe from "./questions/recipe.js";
import scan from "./questions/scan.js";
import collect_block from "./shortcuts/collect_block.js";
import mine from "./shortcuts/mine.js";
import strip_mine from "./shortcuts/strip_mine.js";

// The skill catalogue. Skills are inputs of the world model: renaming one is a change of the journal format
// (a new schema_version, noted in docs/journal.md), adding one is always fine.
export default {
    // Primitives (basic actions)
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
    dig,
    // Shortcuts (assemblies of primitives)
    collect_block,
    mine,
    strip_mine,
    // Low level (no pathfinder)
    walk,
    look,
    press,
};
