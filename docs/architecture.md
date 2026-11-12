# Target architecture and the path to it

Where the project is going, how the parts fit together, and in which order they are built.
Rules and current state: `CLAUDE.md`. Code map: `docs/overview.md`. Data format: `docs/journal.md`.
This is a direction, not a commitment: the order is decided by measurements on the benches.

## 1. The guiding principle

- Each kind of knowledge goes to the component that fits its nature (CLAUDE.md, "Architecture cognitive").
- Each component starts as a SIMPLE, hand-written version behind an interface that a learned version
  can fill later. The inside is replaced, never the interface. Each replacement is measured with / without.
- A learned component is ADDED (understand, predict, choose). It never replaces a reliable deterministic skill.
- The LLM is used less and less: at first it decides everything; in the end it only decides what really
  needs language and judgment (a new goal, a trade-off, an explanation). Measured as LLM calls per goal
  reached, next to the success rate.

## 2. The components

| Component | Role | Version 1 (simple) | Learned version (later) |
|---|---|---|---|
| Body (Node) | execute: how to walk, break, pick up | skills + reflexes (lava, falls) | never a learned model; a STEVE-1 style policy may become ONE more skill, `act(instruction)` |
| Perception / state | describe the world | `observe` (structured, no pixels) | a learned state encoder (large grids, then pixels) |
| Memory | what the agent KNOWS about this world | facts kept by the code (places, chests, explored areas, unlocked recipes) | fact graph, vector store of memories, LLM-managed memory (MemGPT style), nightly lessons (Reflexion style) |
| World model | predict what an action produces | none yet | supervised heads: success, duration, danger, inventory change, with uncertainty; surprise detection |
| Tactics | react to a known failure | rules in `brain/recovery.py` | chosen with the world model, then a small learned controller |
| Goal manager | know what to want | goal condition (done) + triggers (hunger, monster, full inventory) + Maslow-style priorities as rules | priorities learned from experience |
| Planning | chain steps without asking the LLM | recorded macros (DATA) | short search on the world model (2 or 3 steps ahead) |
| LLM (strategist) | goals, order of steps, language | today: decides everything, in a growing conversation | reads a constructed view, only decides what stays ambiguous |

The user's 4-organ design maps onto it: System 2 LLM + Maslow = LLM + goal manager; MemGPT + GraphRAG =
memory; Mineflayer-CLIP = the text <-> change alignment (section 6); JEPA = the latent world model.

## 3. The target decision loop

```
 an event (new goal, trigger, end of a skill)
   │
   ▼
 GOAL MANAGER: which goal comes first now?
   │
   ▼
 MEMORY + STATE ──► the VIEW built by render.py:
                    goal, state, useful facts, predictions, one line per past turn
   │
   ├─ known situation? ──► MACRO or TACTIC (no LLM call)
   │
   ▼
 LLM: proposes 1 to N candidate plans
   │
   ▼
 WORLD MODEL: scores each candidate (success, cost, danger, uncertainty)
   │   ├─ one candidate is safe      ──► run it
   │   ├─ all are bad                ──► back to the LLM: "this plan will fail: X"
   │   └─ the model is too uncertain ──► run it anyway: a valuable data point
   ▼
 BODY: skills + reflexes ──► result {success, reason, details}
   │
   ▼
 COMPARE with the prediction:
   ├─ surprise ──► journal (training data) + memory ("here, this does not work")
   └─ failure  ──► TACTIC, then the LLM if the tactic is not enough
```

## 4. Who decides, who executes, at each stage

Execution never moves: the BODY always runs the skills (through `execute`, so everything is logged).
What moves is the DECISION. The arbiter is the agent loop (`brain/agent.py`): plain code with explicit
rules about who is asked, in a fixed escalation order. It is never a model itself.

Escalation order: reflex (Node, inside a skill) -> tactic -> macro / planner -> LLM.
The first level that can handle the situation does; the next one is asked only if it cannot.

| Stage | Who chooses the next skill call | Who checks | What the LLM still does |
|---|---|---|---|
| Now (step 6) | the LLM, every call | the code: goal condition, skill results | everything |
| + world model as filter (step 8) | the LLM proposes N candidates; the loop runs the best one by a fixed rule (highest predicted success above a threshold, then lowest cost) | the world model, before the action | proposes, and replans when everything is vetoed |
| + tactics (`recovery.py`) | after a known failure: the tactic's rule | the code | only when the tactic gives up |
| + macros / planner | known goal: the recorded macro; short chains: the planner on the world model | the world model | new goals and choices between options |
| + goal manager | the goal comes from triggers and priorities | the code | long-term goals, explanations, language |

"N candidates": several answers sampled from the LLM (temperature), or one answer asking for alternatives.
To be decided and measured at step 8.

## 5. The links between components (the interfaces)

Every link is DATA with a fixed shape, so that the inside of a component can change.

| From -> to | What goes through | Today | Later |
|---|---|---|---|
| Body -> brain | state (`observe`), skill results | JSON over HTTP | same |
| Body -> journal | transitions (state, skill, args, result, next state) | `transitions.jsonl` | same: the training data of every learned head |
| Memory -> view | the facts useful for this goal | none (conversation) | text lines picked by the code, later by similarity search |
| World model -> loop | per candidate: P(success), duration, danger, predicted inventory change, uncertainty | none | numbers; turned into a sentence by `render.py` for the LLM |
| World model -> memory | surprises (prediction far from the result) | none | a memory entry "this did not work here" |
| LLM -> loop | tool calls (= the plan) | tool calls | same, possibly several candidates |
| Goal text -> code | a checkable condition | `define_goal` -> `{"have": {...}}` | plus a target in the latent space (section 6) |

## 6. From text to a shared latent space

Three tiers, each with the previous one as its baseline.

| Tier | How components talk | What it needs |
|---|---|---|
| 1. Text / JSON (now) | the world model returns numbers, `render.py` writes them as sentences | nothing more |
| 2. A shared text <-> change space | a frozen pretrained TEXT encoder and a learned CHANGE encoder (state before -> state after), aligned by contrastive learning (CLIP / InfoNCE) on (sentence, change) pairs | collection data, labeled: templates, then paraphrases by a local LLM, a sample checked by hand |
| 3. The LLM plugged into the latent | an adapter maps between the open LLM's internal representations and the world model's space; LoRA / distillation | the LLM loaded in Python on the 4090 (not Ollama) |

The pair is about the CHANGE ("gathered 3 oak logs"), not the final state: the same sentence is true
from any start. Tier 2 is useful as soon as it exists:
- a goal sentence becomes a target point in the space ("build a shelter" -> the expected change), compared
  with the symbolic `define_goal` baseline;
- the planner searches for skill sequences whose predicted change is close to that target;
- hindsight relabeling: an episode is labeled by what it REALLY did (the nearest sentence to its change);
- memory retrieval by meaning (next section).

JEPA comes only when the state becomes too big for simple heads (large grids, then pixels): prediction
in the latent space, with a slowly updated target encoder, watching for collapse.

## 7. Linking the text memory to the latent space

One memory entry is ONE record with three faces. None of them is a second source of truth:

```
{
  "text":    "A chest with 12 iron ingots at (120, 64, -30).",   // what the LLM reads
  "data":    {"kind": "chest", "pos": [120, 64, -30], "items": {"iron_ingot": 12}},  // what the code checks
  "refs":    ["<transition ids in the journal>"],                // where it comes from (the truth)
  "vectors": {"text": [...], "situation": [...]}                 // tier 2 only: for search
}
```

- The JOURNAL is the source: memory entries are derived from transitions (skill results), never typed in
  by hand and never by the LLM alone. An entry can always be rebuilt or checked from its `refs`.
- The TEXT is a view for the LLM, written by templates first (like `render.py`).
- The DATA is what the code uses: a fact graph is these records linked by their fields
  (base -> chest -> content -> position), queried by code, not by similarity.
- The VECTORS (tier 2) only serve to FIND entries:
  - `text`: the text encoder applied to the entry; the current goal, encoded the same way, finds the
    entries close in meaning ("I need iron" -> the chest above);
  - `situation`: the state / change encoder applied to the entry's transitions; the current state finds
    "what happened last time in a similar situation" (precursor of macros, and of learned tactics).
- Tier 3: retrieved entries could reach the LLM as vectors (adapter "memory tokens", like an image projector
  in a vision LLM) instead of text. Research, uncertain: always measured against the text version.

So the two memories are not separate systems: the latent space is an INDEX over facts that stay readable
data and text, and the journal stays the ground truth.

## 8. Skills and data stability

The world model learns the PHYSICS of the body ("in this state, this skill gives this"), not the LLM's
strategy. Consequences:
- Changing the brain (memory, view, another LLM, tactics) does not break the collected data: it changes
  which situations are visited, not the laws of the world.
- What breaks data is changing an EXISTING skill: its name, its arguments, or its behavior. Old rows then
  describe a skill that no longer exists. Every row has the code commit (`code_version`): old rows can be
  filtered or weighed, but it is better to avoid it.
- ADDING a skill later is fine: it is a new input value for the world model. Old data stays valid; the new
  skill simply has no data until it is used (cold start, high uncertainty, which the ensemble shows).
  To help the model generalize to new skills, the skill can be encoded by features of its arguments and
  later by the embedding of its description, not only by a one-hot id.
- So: freeze only the skills that will be collected (names, arguments, behavior), and keep adding skills
  as goals need them (CLAUDE.md: add by frequency of `missing_capability`, not by intuition).

### Decided for stage A: digging to find what is hidden (2026-10-23; written: `skills/actions/dig.js`, `skills/shortcuts/strip_mine.js`)
Hidden blocks are found by DIGGING, never by asking: `break_block` refuses a block not in sight
(`not_seen`, without saying what it is). How a player mines: caves (ore visible on the walls: `in_sight`,
then `mine`), or straight tunnels.
- Primitive `dig(direction, distance, slope?, stop_at?)`: a tunnel the size of the bot (1 wide, 2 high),
  straight; `slope` `up` / `down` = a staircase, never straight up or down (lava, falls, gravel). Same instincts as `walk` (lava, water, drop).
  `stop_at` (names or game groups): stops as soon as one of them COMES into sight (compared with what was
  in sight when it started, otherwise a block skipped earlier would stop it at every step).
  Details: what was dug, what came into sight.
- Shortcut (name to choose, e.g. `strip_mine(direction, blocks, max_seconds?, until?)`) = `dig` +
  `collect_block` repeated: dig straight; whenever blocks of the list are in sight, collect EVERY one within
  reach of the tunnel (all kinds of the list in the same tunnel, veins too: they come into sight as they
  are uncovered), at most a few blocks (3-4) away from the tunnel axis (otherwise it follows a cave and is
  no longer a tunnel); back to the axis, and on. Stops when the time is over (`max_seconds`: a normal end,
  asked by the brain), when the inventory has `until` (the goal-condition format, `{"diamond": 32,
  "redstone": 16}`; the blocks to aim at come from the game's drops), whichever comes first (`partial` if
  `until` is not met when the time is over), at the maximum distance, on an alert or a danger.
- Missing tool: checked at the start against the inventory (the game's `harvestTools`): kinds that cannot be
  harvested are REMOVED and the shortcut runs with the rest, reported in `details.skipped` (kind -> tools),
  not a failure. Refused at once (`no_tool`) only when nothing harvestable is left, or when an `until`
  count cannot be reached (digging for nothing until the time is over). A tool that breaks on the way: the
  kinds it made possible go to `skipped` from then on.
- Accepted limit (by design): a 1x2 tunnel only shows the blocks touching it (6 per step). Finding more is
  STRATEGY (parallel tunnels 2-3 apart, depth), chosen by the brain over several calls, not the skill.
  A wider tunnel option only if the measurements ask for it.
- `max_seconds` for EVERY skill (applied by `runSkill`, under the hard cap): the brain's own time limit,
  the first step towards `too_long` becoming a brain decision. Long tunnels make full sense once the hard
  cap is removed; until then the shortcut returns what it got and the brain calls it again.
- Each `dig` and `collect_block` has its own journal line (`parent_seq`): short horizons for the world
  model even when the top call lasts minutes.

## 9. The stages, in dependency order

| # | Stage | Depends on | Success criterion |
|---|---|---|---|
| A | Freeze the collected skills (names, arguments, behavior) | none | a committed catalogue, declared stable |
| B | Collection (step 7): benches in series, 14B (successes) + small models (failures) + scripted scenarios | A | a few thousand varied transitions |
| C | World model v1: supervised heads on the structured state | B | beats the trivial baselines (base rate, median) on unseen places |
| D | World model as a filter (step 8) | C | small LLM + world model: better success and/or fewer calls than the small LLM alone |
| E | Constructed view + fact memory + `recovery.py` | none (can run in parallel with B) | bounded context; success at least as good; fewer turns |
| F | Autonomy: triggers + prioritized goals | E | the agent survives and progresses without a given goal |
| G | Planning: macros as data, short search on the world model | C, D | fewer LLM calls per goal |
| H | Representations: labeling, contrastive text <-> change, shared encoder | B (a lot of data) | finds the right episode from a sentence; matches `define_goal` |
| I | Local LLM in Python (4090), latent adapter, LoRA / distillation | H, the machine | A/B against the text tier |
| J | Later: pixels / JEPA, STEVE-1 as a skill, several bots, voice, RL | measurements | none fixed |

E needs no data: it can be developed during the day while the collection runs at night.

## 10. Risks to keep in mind

- Data volume: about 300 transitions per hour per bot, in real time. Several bots in parallel and scripted
  scenarios are needed (an LLM alone explores little; a random bot never reaches interesting states).
- State representation for the world model: `observe` is a variable-size dict; a fixed-size vector must be
  derived from it (inventory, nearby blocks, health, food...). First real decision of stage C.
- Value of the world model against a strong LLM: qwen2.5:14b already does `crafting_table` 3/3. On such
  tasks the gain will show as COST (fewer calls, less time) and SAFETY (danger) more than success. Harder
  tasks are needed for success to make the difference.
- Tier 3 (LLM plugged into the latent) is research: it may not beat the text tier. It is measured, never assumed.
