// Low level, the "controller" level: hold some keys for a number of ticks (20 per second), then release
// them. The direction comes from where the bot looks (see look). RAW input, on purpose: no instinct and
// no danger check (walk has them); what happened is in the result and the trace. Not shown to the LLM
// for now: for tactics, scripted and random exploration (varied data), and later a learned controller.
import { round1, sleep } from "./utils.js";

const KEYS = ["forward", "back", "left", "right", "jump", "sprint", "sneak"];
const MAX_TICKS = 40; // 2 s

async function press(bot, { keys, ticks = 10 } = {}) {
    if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        !keys.every((k) => KEYS.includes(k)) ||
        !Number.isInteger(ticks) ||
        ticks < 1 ||
        ticks > MAX_TICKS
    )
        return {
            success: false,
            reason: "invalid_args",
            details: { keys, ticks, known_keys: KEYS, max_ticks: MAX_TICKS },
        };

    const start = bot.entity.position.clone();
    try {
        for (const k of keys) bot.setControlState(k, true);
        await sleep(ticks * 50);
    } finally {
        for (const k of keys) bot.setControlState(k, false);
    }
    const p = bot.entity.position;
    return {
        success: true,
        reason: "ok",
        details: {
            keys,
            ticks,
            start: [start.x, start.y, start.z].map(round1),
            end: [p.x, p.y, p.z].map(round1),
            moved: round1(p.distanceTo(start)),
        },
    };
}

press.budget = (bot, { ticks = 10 }) => ticks / 20 + 1;

export default press;
export { KEYS, MAX_TICKS };
