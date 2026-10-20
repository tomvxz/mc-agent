// The body's HTTP API: this is how the brain (Python) talks to the bot.
// The body decides nothing: it reports its state, describes its skills and runs what it is asked to.
//   GET  /state    -> observe(bot)
//   GET  /skills   -> the skills shown to the LLM (src/skills/catalogue.js); /skills?all=1 -> all of them
//   GET  /run      -> the current run: run_id, purpose, data_dir, versions... (src/run.js)
//   POST /execute  -> { name, args, source, episode_id, turn }: runs ONE skill (logged)
// Uses Node's built-in http module: no dependency.

import http from "node:http";
import execute from "./execute.js";
import { currentRun } from "./run.js";
import { CATALOGUE, COMMON_REASONS, SHOWN_TO_LLM } from "./skills/catalogue.js";
import { observe } from "./state.js";

const MAX_BODY_SIZE = 100 * 1024; // larger request bodies are rejected

// Send a JSON response
function reply(res, code, data) {
  const text = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

// Read the request body and parse it as JSON (or throw)
function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > MAX_BODY_SIZE) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Check an execute request; returns an error message, or null if everything is fine
function validateRequest(d) {
  if (typeof d !== "object" || d === null || Array.isArray(d))
    return "the body must be a JSON object";
  if (typeof d.name !== "string") return "name must be a string";
  if (
    d.args !== undefined &&
    (typeof d.args !== "object" || d.args === null || Array.isArray(d.args))
  )
    return "args must be an object";
  if (d.source !== undefined && typeof d.source !== "string")
    return "source must be a string";
  if (d.episode_id !== undefined && typeof d.episode_id !== "string")
    return "episode_id must be a string";
  if (d.turn !== undefined && !Number.isInteger(d.turn))
    return "turn must be an integer";
  const allowed = ["name", "args", "source", "episode_id", "turn"];
  const unknown = Object.keys(d).filter((k) => !allowed.includes(k));
  if (unknown.length) return `unknown fields: ${unknown.join(", ")}`;
  return null;
}

function startApi(bot, { port = 3000, host = "127.0.0.1" } = {}) {
  // One skill at a time: the bot only has one body
  let busy = false;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/state") {
        let state;
        try {
          state = observe(bot);
        } catch (e) {
          return reply(res, 503, {
            error: "bot_unavailable",
            message: e.message,
          }); // dead or disconnected
        }
        return reply(res, 200, state);
      }

      // The skills shown to the LLM (SHOWN_TO_LLM); /skills?all=1 for all of them
      if (
        req.method === "GET" &&
        (req.url === "/skills" || req.url === "/skills?all=1")
      ) {
        const all = req.url.endsWith("all=1");
        const skills = Object.fromEntries(
          Object.entries(CATALOGUE).filter(
            ([name]) => all || SHOWN_TO_LLM.includes(name),
          ),
        );
        return reply(res, 200, { common_reasons: COMMON_REASONS, skills });
      }

      if (req.method === "GET" && req.url === "/run") {
        const run = currentRun();
        if (!run)
          return reply(res, 503, {
            error: "no_run",
            message: "the run has not started yet",
          });
        return reply(res, 200, run);
      }

      if (req.method === "POST" && req.url === "/execute") {
        let request;
        try {
          request = await readJson(req);
        } catch (e) {
          return reply(res, 400, {
            error: "invalid_request",
            message: e.message,
          });
        }
        const problem = validateRequest(request);
        if (problem)
          return reply(res, 400, {
            error: "invalid_request",
            message: problem,
          });
        if (busy)
          return reply(res, 409, {
            error: "busy",
            message: "a skill is already running",
          });

        busy = true;
        try {
          const { name, args = {}, source = "api", episode_id, turn } = request;
          // An unknown name is not an HTTP error: execute returns (and logs) unknown_skill
          const result = await execute(bot, name, args, source, {
            episode_id,
            turn,
          });
          return reply(res, 200, result);
        } finally {
          busy = false;
        }
      }

      const routeExists = ["/state", "/skills", "/run", "/execute"].includes(
        req.url,
      );
      return reply(res, routeExists ? 405 : 404, {
        error: routeExists ? "method_not_allowed" : "not_found",
      });
    } catch (e) {
      // Nothing may bring the server down
      console.error("[api] error:", e);
      if (!res.headersSent)
        reply(res, 500, { error: "internal_error", message: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

export { startApi };
