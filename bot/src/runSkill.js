import { startSkill } from "./cancel.js";

async function runSkill(bot, skill, args, timeoutMs = 60000) {
  const start = Date.now();
  let timer;

  // A promise that fails after timeoutMs
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  // The skill runs in its own context, so that it can be really stopped (see cancel.js)
  const running = startSkill(bot, () => skill(bot, args));

  let result;
  try {
    // Whichever finishes first wins: the skill or the deadline
    result = await Promise.race([running.promise, deadline]);
  } catch (e) {
    const timedOut = e.message === "timeout";
    result = {
      success: false,
      reason: timedOut ? "timeout" : "exception",
      details: { error: e.message },
      // The full error, for debugging and for the journal (null for a plain timeout)
      error: timedOut
        ? null
        : {
            type: e.name,
            message: e.message,
            stack: String(e.stack || "").slice(0, 2000),
          },
    };
    running.cancel(); // from now on, the skill's actions are refused (it may still be running)
    // setGoal(null) stops immediately; stop() waited for the next block
    // and made the following skill fail (instant no_path)
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
  } finally {
    clearTimeout(timer);
    // A finished skill must not act anymore either (e.g. a forgotten background wait)
    running.cancel();
    // A timed-out skill may still reject later (its actions are refused): not an error to report
    running.promise.catch(() => {});
  }

  // A skill that does not return { success, reason } is a bug
  if (!result || typeof result.success !== "boolean") {
    result = {
      success: false,
      reason: "bad_result",
      details: { value: result },
    };
  }

  return { ...result, duration: (Date.now() - start) / 1000 };
}

export default runSkill;
