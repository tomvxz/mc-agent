// Low level: turn the head. yaw and pitch in radians, the same convention as the state (observe):
// yaw 0 = north (-z), pi/2 = west; pitch 0 = level, positive = up. Useful before press.
// Not shown to the LLM for now (see SHOWN_TO_LLM).
import { round1 } from "./utils.js";

async function look(bot, { yaw, pitch = 0 } = {}) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(pitch) > Math.PI / 2)
        return { success: false, reason: "invalid_args", details: { yaw, pitch } };
    await bot.look(yaw, pitch, true);
    return {
        success: true,
        reason: "ok",
        details: { yaw: round1(bot.entity.yaw ?? yaw), pitch: round1(bot.entity.pitch ?? pitch) },
    };
}

look.budget = () => 1;

export default look;
