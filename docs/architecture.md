# Target architecture and the path to it

Where the project is going, how the parts fit together, and in which order they are built.
Rules: `CLAUDE.md`. Current state, measurements, decisions: `docs/status.md`. Code map: `docs/overview.md`. Data format: `docs/journal.md`.
This is a direction, not a commitment: the order is decided by measurements on the benches.

## 1. The guiding principle

- Each kind of knowledge goes to the component that fits its nature.
- Each component starts as a SIMPLE, hand-written version behind an interface that a learned version
  can fill later. The inside is replaced, never the interface. Each replacement is measured with / without.
- A learned component is ADDED (understand, predict, choose). It never replaces a reliable deterministic skill.
- The LLM is used less and less: at first it decides everything; in the end it only decides what really
  needs language and judgment (a new goal, a trade-off, an explanation).

## 2. The components

| Component          | Role                                  | Version 1 (simple)                                                                                    | Improved version (later)                                                                      |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Body (Node)        | execute: how to walk, break, pick up  | skills + reflexes (lava, falls)                                                                       | learned skill based on raw command inputs `act(instruction)`                                  |
| Perception / state | describe the world                    | `observe` (structured, no pixels)                                                                     | Adding pixels or replacing by pixels entirely                                                 |
| Memory             | what the agent KNOWS about this world | facts kept by the code (places, chests, explored areas, unlocked recipes)                             | fact graph, vector store of memories, etc                                                     |
| World model        | predict what an action produces       | simple world model predicting next state based on current and action                                  | Eventually trying to tie it to the LLM through a latent space                                 |
| Tactics            | react to a known failure              | rules in `brain/recovery.py`                                                                          | chosen with the world model, then a small learned controller                                  |
| Goal manager       | know what to want                     | goal condition (done) + triggers (hunger, monster, full inventory) + Maslow-style priorities as rules | priorities learned from experience or suggested by the LLM based on some initial personnality |
| Planning           | chain steps without asking the LLM    | recorded macros (DATA)                                                                                | short search on the world model (2 or 3 steps ahead)                                          |
| LLM (strategist)   | goals, order of steps, language       | today: decides everything, in a growing conversation                                                  |                                                                                               |

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

## 4. The links between components (the interfaces)

Every link is DATA with a fixed shape, so that the inside of a component can change.

| From -> to            | What goes through                                                                    | Today                              | Later                                                      |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| Body -> brain         | state (`observe`), skill results                                                     | JSON over HTTP                     | same                                                       |
| Body -> journal       | transitions (state, skill, args, result, next state)                                 | `transitions.jsonl`                | same: the training data of every learned head              |
| Memory -> view        | the facts useful for this goal                                                       | none (conversation)                | text lines picked by the code, later by similarity search  |
| World model -> loop   | per candidate: P(success), duration, danger, predicted inventory change, uncertainty | none                               | numbers; turned into a sentence by `render.py` for the LLM |
| World model -> memory | surprises (prediction far from the result)                                           | none                               | a memory entry "this did not work here"                    |
| LLM -> loop           | tool calls (= the plan)                                                              | tool calls                         | same, possibly several candidates                          |
| Goal text -> code     | a checkable condition                                                                | `define_goal` -> `{"have": {...}}` | plus a target in the latent space (section 6)              |

## 5. From text to a shared latent space

Three tiers, each with the previous one as its baseline.

| Tier                               | How components talk                                                                                              | What it needs                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Text / JSON (now)               | the world model returns numbers, `render.py` writes them as sentences                                            | nothing more                                                                                   |
| 2. A shared text <-> change space  | a frozen pretrained TEXT encoder and a learned CHANGE encoder (state before -> state after).                     | collection data, labeled: templates, then paraphrases by a local LLM, a sample checked by hand |
| 3. The LLM plugged into the latent | an adapter maps between the open LLM's internal representations and the world model's space; LoRA / distillation | the LLM loaded in Python                                                                       |

The pair is about the CHANGE ("gathered 3 oak logs"), not the final state: the same sentence is true
from any start. Tier 2 is useful as soon as it exists:

- a goal sentence becomes a target point in the space ("build a shelter" -> the expected change), compared
  with the symbolic `define_goal` baseline;
- the planner searches for skill sequences whose predicted change is close to that target;

## 6. Linking the text memory to the latent space (PROPOSED structure for now)

One memory entry is ONE record with three faces. None of them is a second source of trut (suggested format for now):

```
{
  "text":    "A chest with 12 iron ingots at (120, 64, -30).",   // what the LLM reads
  "data":    {"kind": "chest", "pos": [120, 64, -30], "items": {"iron_ingot": 12}},  // what the code checks
  "refs":    ["<transition ids in the journal>"],                // where it comes from (the truth)
  "vectors": {"text": [...], "situation": [...]}                 // tier 2 only: for search
}
```

- The JOURNAL is the source: memory entries are derived from transitions (skill results). A
  n entry should always be rebuilt or checked from its `refs`.
- The TEXT is a view for the LLM, written by templates first (like `render.py`).
- The DATA is for the code: (base -> chest -> content -> position).
- The VECTORS (tier 2) only serve to FIND entries:
    - `text`: the text encoder applied to the entry; the current goal, encoded the same way, finds the
      entries close in meaning ("I need iron" -> the chest above);
    - `situation`: the state / change encoder applied to the entry's transitions; the current state finds
      "what happened last time in a similar situation" (precursor of macros, and of learned tactics).
- Tier 3: retrieved entries could reach the LLM as vectors (adapter "memory tokens", like an image projector
  in a vision LLM) instead of text.

So the two memories are not separate systems: the latent space is an INDEX over facts that stay readable
data and text, and the journal stays the ground truth.

## 7. Skills and data stability

The goal is for the world model to learn the PHYSICS of the body ("in this state, this skill gives this"), not the LLM's strategy. Consequences:

- Changing the brain (memory, view, another LLM, tactics) does not break the collected data: it changes which situations are visited, not the laws of the world.
- What breaks data is changing an EXISTING skill: its name, its arguments, or its behavior. Old rows then
  describe a skill that no longer exists. Every row has the code commit (`code_version`): old rows can be
  filtered or weighed, but it is better to avoid it.
- ADDING a skill later is fine: it is a new input value for the world model. Old data stays valid; the new
  skill simply has no data until it is used.
  To help the model generalize to new skills, the skill can be encoded by features of its arguments and
  later by the embedding of its description, not only by a one-hot id.
- Keep the collected skills steady and avoid trivial changes, but improving one stays possible: it is
  a versioned change of format (`docs/journal.md`: new version, old name -> new name), so that old rows stay
  readable, filtered or weighed. Keep adding skills as goals need them (add by frequency of
  `missing_capability` can help complete intuition).

## 8. Some ideas to extend (an OPEN list: the order is decided by measurements)

Overview and order of the stages: `docs/architecture.md`. Common rule: one component at a time, measured with
/ without on the benches; a learned component is ADDED (understand, predict, choose) and does not replace a
reliable deterministic skill. Directions, not commitments: add and remove according to the data.

- Outside data (discussed 2026-11-13, not for v1): VPT / MineRL are pixels + keyboard/mouse of humans
  (older Minecraft versions), not (structured state, skill call) -> result: useful later for the low-level
  controller (`walk`/`look`/`press`, same kind of actions) and the pixel stage, not for the skill world model.
  Human play on our own server, recorded by a server plugin in our format with `source: human`: same state
  format, events close to our primitives, but it describes a human's body, not our skills' costs and failures;
  if tried, as extra data with a source input, measured with / without on unseen places. The volume lever for
  v1 is several bots in parallel and more seeds / biomes.
- Autonomy: triggers (hunger, health, full inventory, monster): a Node reflex interrupts the skill and wakes the
  brain with an alert message; a goal generator with Maslow-style priorities (survive > eat > shelter > tools >
  explore), written as DATA / rules the LLM uses; a long-term goal ("a castle") kept in memory.
- Memory, in stages: history summarized by the code, then the prompt as a constructed view; facts kept by the
  code (places, chests and their content, explored areas), updated from the skill results; later a fact graph
  (GraphRAG), a vector store of memories and lessons, memory managed by the LLM (MemGPT style) with a strong
  enough model, a "nightly compression" (an LLM rereads the day's journal and writes lessons, Reflexion style);
  retrieval of past experiences (successful plans for a close goal), a precursor of macros; game knowledge
  filtered by experience: "unlocked" recipes (seen or crafted) instead of all, measured all / unlocked / none.
- Learning on the journal (COLLECTION data only, never dev): supervised heads (step 7) against trivial
  baselines; hindsight relabeling (cf. STEVE-1); describing changes in sentences (templates, then paraphrases
  by a local LLM; check a sample by hand); contrastive alignment text <-> change (InfoNCE, frozen pretrained
  text encoder + learned state encoder), compared with the symbolic baseline `define_goal`; a shared state
  encoder, then prediction in the latent space (JEPA: slow target encoder, watch for collapse) when the state
  grows; LoRA fine-tuning of the small LLM on successful episodes, distillation from a large model, A/B with
  the world model.
- Data: mix LLM episodes, scripted curricula (benches), random exploration (a purely random bot never reaches
  interesting states); several bots in parallel; count ~300 transitions per hour per bot.
- Planning: macros recorded by the LLM (DATA, a mini-language if needed), a planner on the world model (fewer
  LLM calls), a learned controller for tactics.
- Learned gestures as extra skills next to the written ones (trained on walk / press data), measured with /
  without; the written gesture stays as reference and fallback.
- A body inside the server (plugin / mod, the server simulates the bot: no client copy to keep in sync) if
  Mineflayer keeps costing fixes; the brain, the journal and the API would stay.
- Later still: several bots and roles, voice, pixels (visual JEPA; a STEVE-1 style policy as ONE more skill,
  `act(instruction)`, wrapped like the others), RL on a behavior that plateaus.
