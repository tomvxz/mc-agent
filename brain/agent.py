"""The agent loop (step 6: the LLM alone, the baseline of step 8).

    goal -> (LLM turns it into a condition, brain/goal.py)
         -> [LLM calls skills (tools) -> run them in order, stop at the first failure
             -> answer each call with its result, then show the new state] -> ... until
             the condition is met (checked by the code), goal_reached, or max_turns

The loop only handles PLANS (lists of skill calls) and RESULTS. How they are turned into text
(render.py) and how the LLM is called (llm.py) are separate, so that later:
- step 8 inserts the world model between "the LLM proposes" and "we run";
- a shared latent space can replace the text interface without touching this loop.

Usage (bot running in API mode, LLM server running):
    uv run python -m brain.agent "craft a wooden pickaxe" --max-turns 10
    uv run python -m brain.agent "collect 3 oak logs" --no-condition   # the LLM alone says when it is done
"""

import argparse
import pathlib
from typing import Any, Callable

from brain import goal as goals
from brain import render
from brain.body import Body, BodyError
from brain.journal import EpisodeLog
from brain.llm import GOAL_REACHED, MISSING_CAPABILITY, LLMError, LLMReply, OpenAICompatibleLLM

MAX_STEPS_PER_PLAN = 10  # a longer plan is cut (the LLM sees the results and continues)

LLM = Callable[[list[dict[str, Any]], list[dict[str, Any]]], LLMReply]


def run_episode(
    goal: str,
    body: Body,
    llm: LLM,
    max_turns: int = 10,
    scenario: str | None = None,
    episodes_file: pathlib.Path | None = None,
    goal_condition: bool = False,
) -> dict[str, Any]:
    """Run one episode and return its outcome. Everything is logged (episodes + transitions).

    llm: anything with the llm.py interface (OpenAICompatibleLLM, FakeLLM, later a version with
    a world model filter). episodes_file: where to log (default: the body's run folder).
    goal_condition: first ask the LLM to turn the goal into a condition (brain/goal.py), checked by
    the code on every new state (the command line does it by default; off here for the tests).
    """
    run = body.run()
    catalogue = body.skills()
    tools = render.skill_tools(catalogue)
    system = render.system_prompt()
    path = episodes_file or pathlib.Path(run["data_dir"]) / "episodes.jsonl"

    skill_calls = 0
    condition = None
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
                "condition": condition,
            }

        def progress(state: dict[str, Any] | None) -> dict[str, tuple[int, int]] | None:
            return goals.progress(condition, state) if condition else None

        try:
            start_state = body.state()
        except BodyError as e:
            return finish(False, "body_error", str(e))

        # 0. The goal as a condition: a separate call with one tool (logged as turn 0). An unusable
        #    answer is not asked again: the episode goes on without a condition (goal_reached).
        if goal_condition:
            definition = render.render_goal_definition(goal)
            try:
                reply = llm(definition, render.goal_definition_tools())
            except LLMError as e:
                return finish(False, "llm_error", str(e))
            condition, error = (None, reply.parse_error) if reply.parse_error else goals.parse_condition(reply.calls)
            log.turn(
                new_messages=definition,
                raw_response=reply.raw,
                plan=[],
                parse_error=error,
                latency=reply.latency,
                tokens=reply.tokens,
            )
            if condition and goals.is_met(condition, start_state):
                return finish(True, "condition_met")

        first = {"role": "user", "content": render.render_goal(goal, start_state, progress(start_state))}
        messages = [{"role": "system", "content": system}, first]
        new_messages = [
            first
        ]  # what was added since the previous LLM call (recorded per turn)
        shown_state = start_state  # the state shown to the LLM at the previous turn
        last_failure = None  # (skill, args, reason) of the previous turn's failure
        counted = 0  # turns counted against max_turns (a first empty answer is not counted)
        free_retry_used = False  # the previous answer was empty and asked again for free

        while counted < max_turns:
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

            # An EMPTY answer (no text, no usable tool call) does not use a turn, once in a row.
            # Seen with qwen2.5:3b + Ollama when skills were not tools: the model called a skill
            # anyway, Ollama did not know this tool and dropped the whole answer. It is still
            # logged above, like every LLM call.
            empty = reply.parse_error is not None and not reply.text
            if empty and not free_retry_used:
                free_retry_used = True
            else:
                free_retry_used = False
                counted += 1

            # 2. An unusable answer: explain why and ask again
            if reply.parse_error:
                feedback = {
                    "role": "user",
                    "content": render.render_parse_error(reply.parse_error),
                }
                messages.append(feedback)
                new_messages.append(feedback)
                continue

            # 3. Nothing to run: the LLM says the goal is reached (or only said what it misses)
            plan = (
                reply.plan or []
            )  # never None here: a None plan comes with a parse_error
            if reply.done and not plan and condition is None:
                return finish(True, "done")
            if reply.done and not plan:  # with a condition: not met (it would have ended the episode)
                feedback = answers(reply, [], catalogue, progress(shown_state)) + [
                    {"role": "user", "content": render.render_new_state(shown_state, progress=progress(shown_state))}
                ]
                messages += feedback
                new_messages += feedback
                continue
            if not plan:
                feedback = answers(reply, [], catalogue) + [
                    {"role": "user", "content": render.render_empty_plan()}
                ]
                messages += feedback
                new_messages += feedback
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

            # The condition is checked by the code on every new state
            if condition and goals.is_met(condition, state):
                return finish(True, "condition_met")
            # done=true with a plan: the LLM expects the goal reached once the plan has run
            if reply.done and condition is None and all(r["result"]["success"] for r in results):
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
            text = render.render_new_state(
                state, previous_state=shown_state, repeated_failure=repeated, progress=progress(state)
            )
            shown_state = state
            feedback = answers(reply, results, catalogue, progress(state)) + [
                {"role": "user", "content": text}
            ]
            messages += feedback
            new_messages += feedback

        return finish(False, "max_turns")


def answers(
    reply: LLMReply,
    results: list[dict[str, Any]],
    catalogue: dict[str, Any],
    progress: dict[str, tuple[int, int]] | None = None,
) -> list[dict[str, Any]]:
    """One "tool" message per call of the answer, in order (the chat API expects an answer to
    every tool call): the skill's result, "not run", or "noted" for the two other tools
    (goal_reached "not accepted" if a skill failed or the goal condition is not met)."""
    plan_succeeded = all(r["result"]["success"] for r in results)
    remaining = iter(results)  # the results are in the order of the skill calls
    messages = []
    for call in reply.calls:
        if call["name"] in (GOAL_REACHED, MISSING_CAPABILITY):
            text = render.render_noted(call["name"], plan_succeeded, progress)
        else:
            step = next(remaining, None)
            text = render.render_result(step, catalogue) if step else render.render_not_run()
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": text})
    return messages


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one LLM episode with the bot.")
    parser.add_argument("goal", help='e.g. "craft a wooden pickaxe"')
    parser.add_argument("--max-turns", type=int, default=10)
    parser.add_argument(
        "--scenario", default=None, help="optional label of the setting"
    )
    parser.add_argument(
        "--no-condition", action="store_true", help="no goal condition: only the LLM's goal_reached"
    )
    args = parser.parse_args()

    llm = OpenAICompatibleLLM()
    print(f"LLM: {llm.model} at {llm.base_url}")
    with Body() as body:
        outcome = run_episode(
            args.goal,
            body,
            llm,
            max_turns=args.max_turns,
            scenario=args.scenario,
            goal_condition=not args.no_condition,
        )
    print(outcome)


if __name__ == "__main__":
    main()
