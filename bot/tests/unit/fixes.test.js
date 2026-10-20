import assert from "node:assert";
import test from "node:test";
import AABB from "prismarine-physics/lib/aabb.js";
import { fixWallContact, WALL_GAP } from "../../src/fixes.js";

test("fixWallContact: a horizontal move stops 1 mm before a block face, a vertical one does not", () => {
    fixWallContact();
    const block = new AABB(0, 0, 0, 1, 1, 1); // the block from x=0 to x=1
    const player = new AABB(1.5, 0, 0.2, 2.1, 1.8, 0.8); // 0.5 block east of it
    // Walking west by 1 block would go through: stopped WALL_GAP before the face (x = 1)
    assert.ok(Math.abs(block.computeOffsetX(player, -1) - (-0.5 + WALL_GAP)) < 1e-12);
    // Same on z
    const north = new AABB(0.2, 0, 1.5, 0.8, 1.8, 2.1);
    assert.ok(Math.abs(block.computeOffsetZ(north, -1) - (-0.5 + WALL_GAP)) < 1e-12);
    // A move that does not reach the block is unchanged
    assert.strictEqual(block.computeOffsetX(player, -0.2), -0.2);
    // Falling onto the block: stops exactly on it (standing on the ground is exact)
    const above = new AABB(0.2, 1.5, 0.2, 0.8, 3.3, 0.8);
    assert.strictEqual(block.computeOffsetY(above, -1), -0.5);
});
