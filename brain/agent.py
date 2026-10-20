"""The agent loop (step 6: the LLM alone, the baseline of step 8).

    goal -> [LLM proposes a plan -> run it skill by skill, stop at the first failure
             -> show the results and the new state to the LLM] -> ... until done or max_turns

The loop only handles PLANS (lists of skill calls) and RESULTS. How they are turned into text
(render.py) and how the LLM is called (llm.py) are separate, so that later:
- step 8 inserts the world model between "the LLM proposes" and "we run";
- a shared latent space can replace the text interface without touching this loop.

Usage (bot running in API mode, LLM server running):
    uv run python -m brain.agent "craft a wooden pickaxe" --max-turns 10
"""

import argparse
import pathlib
from typing import Any, Callable

from brain import render
from brain.body import Body, BodyError
from brain.journal import EpisodeLog
from brain.llm import LLMError, LLMReply, OpenAICompatibleLLM, propose_plans_tool

MAX_STEPS_PER_PLAN = 10  # a longer plan is cut (the LLM sees the results and continues)

LLM = Callable[[list[dict[str, Any]], list[dict[str, Any]]], LLMReply]


def run_episode(
    goal: str,
    body: Body,
    llm: LLM,
    max_turns: int = 10,
    scenario: str | None = None,
    episodes_file: pathlib.Path | None = None,
) -> dict[str, Any]:
    """Run one episode and return its outcome. Everything is logged (episodes + transitions).

    llm: anything with the llm.py interface (OpenAICompatibleLLM, FakeLLM, later a version with
    a world model filter). episodes_file: where to log (default: the body's run folder).
    """
    run = body.run()
    catalogue = body.skills()
    tools = [propose_plans_tool(list(catalogue["skills"]))]
    system = render.system_prompt(catalogue)
    path = episodes_file or pathlib.Path(run["data_dir"]) / "episodes.jsonl"

    skill_calls = 0
    with EpisodeLog(path=path) as log:
        log.start(
            goal=goal,
            model=getattr(llm, "model_info", {"provider": "unknown"}),
            system_prompt=system,
            tools=tools,
            max_turns=max_turns,
            run_id=run["run_id"],
            scenario=scenario,
        )

        def finish(
            success: bool, reason: str, error: str | None = None
        ) -> dict[str, Any]:
            try:
                final_state = body.state()
            except BodyError:
                final_state = None
            log.end(
                success=success,
                reason=reason,
                skill_calls=skill_calls,
                error=error,
                final_state=final_state,
            )
            return {
                "episode_id": log.episode_id,
                "success": success,
                "reason": reason,
                "skill_calls": skill_calls,
                "error": error,
            }

        try:
            start_state = body.state()
        except BodyError as e:
            return finish(False, "body_error", str(e))
        first = {"role": "user", "content": render.render_goal(goal, start_state)}
        messages = [{"role": "system", "content": system}, first]
        new_messages = [
            first
        ]  # what was added since the previous LLM call (recorded per turn)
        shown_state = start_state  # the state shown to the LLM at the previous turn
        last_failure = None  # (skill, args, reason) of the previous turn's failure

        for _ in range(max_turns):
            # 1. Ask the LLM
            try:
                reply = llm(messages, tools)
            except LLMError as e:
                return finish(False, "llm_error", str(e))
            turn = log.turn(
                new_messages=new_messages,
                raw_response=reply.raw,
                plan=reply.plan,
                missing_capability=reply.missing_capability,
                done=reply.done,
                parse_error=reply.parse_error,
                latency=reply.latency,
                tokens=reply.tokens,
            )
            answer = reply.history_message()
            messages.append(answer)
            new_messages = [answer]

            # 2. An unusable answer: explain why and ask again
            if reply.parse_error:
                feedback = {
                    "role": "user",
                    "content": render.render_parse_error(reply.parse_error),
                }
                messages.append(feedback)
                new_messages.append(feedback)
                continue

            # 3. Nothing to do: the LLM says the goal is reached (or forgot to plan anything)
            plan = (
                reply.plan or []
            )  # never None here: a None plan comes with a parse_error
            if reply.done and not plan:
                return finish(True, "done")
            if not plan:
                feedback = {"role": "user", "content": render.render_empty_plan()}
                messages.append(feedback)
                new_messages.append(feedback)
                continue

            # 4. Run the plan, skill by skill, stop at the first failure
            results = []
            try:
                for step in plan[:MAX_STEPS_PER_PLAN]:
                    result = body.execute(
                        step["skill"],
                        step["args"],
                        episode_id=log.episode_id,
                        turn=turn,
                    )
                    skill_calls += 1
                    results.append({**step, "result": result})
                    if not result["success"]:
                        break
                state = body.state()
            except BodyError as e:
                return finish(False, "body_error", str(e))

            # done=true with a plan: the LLM expects the goal reached once the plan has run
            if reply.done and all(r["result"]["success"] for r in results):
                return finish(True, "done")

            # 5. Show the results and the new state for the next turn (with deaths / damage, and a
            #    warning if the LLM repeated exactly the failure of the previous turn)
            failure = next(
                (
                    (r["skill"], repr(r["args"]), r["result"]["reason"])
                    for r in results
                    if not r["result"]["success"]
                ),
                None,
            )
            repeated = failure is not None and failure == last_failure
            last_failure = failure
            text = render.render_results(
                results,
                catalogue,
                state,
                previous_state=shown_state,
                repeated_failure=repeated,
            )
            shown_state = state
            feedback = {"role": "user", "content": text}
            messages.append(feedback)
            new_messages.append(feedback)

        return finish(False, "max_turns")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one LLM episode with the bot.")
    parser.add_argument("goal", help='e.g. "craft a wooden pickaxe"')
    parser.add_argument("--max-turns", type=int, default=10)
    parser.add_argument(
        "--scenario", default=None, help="optional label of the setting"
    )
    args = parser.parse_args()

    llm = OpenAICompatibleLLM()
    print(f"LLM: {llm.model} at {llm.base_url}")
    with Body() as body:
        outcome = run_episode(
            args.goal, body, llm, max_turns=args.max_turns, scenario=args.scenario
        )
    print(outcome)


if __name__ == "__main__":
    main()
