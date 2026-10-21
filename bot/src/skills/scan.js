import { inSight, perceivesEntity, perception, SIGHT_RADIUS } from "../perception.js";
import { round1 } from "./utils.js";

// Question (changes nothing in the world): summary of what the bot PERCEIVES around it (src/perception.js:
// by default in line of sight, not through walls). The blocks are the same summary as the state's
// in_sight (one computation), within the radius asked; + the entities.
async function scan(bot, { radius = 16 } = {}) {
    if (!Number.isFinite(radius) || radius <= 0 || radius > SIGHT_RADIUS) {
        return { success: false, reason: "invalid_args", details: { radius } };
    }
    const pos = bot.entity.position;

    // 1. Every kind of block perceived (no list)
    const blocks = {};
    for (const [name, b] of Object.entries(inSight(bot, radius)))
        blocks[name] = { count: b.count, nearest: b.nearest };

    // 2. Entities (animals, monsters, players, items on the ground), except the bot itself
    const entities = {};
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || !e.position) continue;
        const d = e.position.distanceTo(pos);
        if (d > radius || !perceivesEntity(bot, e)) continue;
        const name = e.name || e.type;
        const s =
            entities[name] ||
            (entities[name] = { count: 0, nearest: null, distance: Infinity });
        s.count++;
        if (d < s.distance) {
            s.distance = round1(d);
            s.nearest = [e.position.x, e.position.y, e.position.z].map(round1);
        }
    }

    return {
        success: true,
        reason: "ok",
        details: {
            radius,
            perception: perception(),
            blocks,
            entities,
            // counts are cells seen by a fan of rays (src/perception.js), not every block of the kind
        },
    };
}

export default scan;
