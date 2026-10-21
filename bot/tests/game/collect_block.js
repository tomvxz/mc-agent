// collect_block = break_block + pick_up: the same cases as break_block, but the item must reach
// the inventory, and an item falling out of reach is a failure (not_collected).
import { brokenAndCollected, commonEdgeCases, nominalCases, topOfColumn } from "./break_block.js";

const nominal = nominalCases(brokenAndCollected);
const edgeCases = [topOfColumn("no_path"), ...commonEdgeCases];

export const skill = "collect_block";
export { edgeCases, nominal };
