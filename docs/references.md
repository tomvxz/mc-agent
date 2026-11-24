# References: AI research on Minecraft

The papers that matter most for mc-agent, grouped by what we can take from them. Each entry gives the
idea in one line and what it means for this project.

Written from memory (November 2026). Search for the title to check the authors, year and arXiv link
before citing one.

## 1. LLM agents that call skills (closest to our brain + body)

| Paper | Idea | For mc-agent |
|---|---|---|
| **Voyager** (Wang et al., 2023, arXiv 2305.16291) | GPT-4 writes JavaScript skills for Mineflayer, keeps them in a library, follows an automatic curriculum, fixes code from errors. | Our inspiration and baseline (CLAUDE.md). The difference: we write the primitives by hand and learn a world model, while the LLM never writes code. |
| **Odyssey** (Liu et al., 2024, arXiv 2407.15325) | Mineflayer plus a large library of hand-written skills, an LLaMA model fine-tuned on Minecraft Q&A, and a benchmark of long tasks. | The closest to our design (hand-written skills plus an open LLM). Their benchmark is useful for comparison. |
| **MineLand** (Yu et al., 2024, arXiv 2403.19267) | A multi-agent simulator built on Mineflayer, with limited senses and physical needs (food, sleep). | Several bots and survival needs: ideas for collecting more varied data. |
| **Mindcraft / MineCollab** (White et al., 2025, arXiv 2504.17950) | An open Mineflayer framework where LLM agents chat and work together (cooking, crafting, building). | An open-source agent on the same stack. Read it to compare skill sets and prompts. |
| **DEPS** (Wang et al., NeurIPS 2023, arXiv 2302.01560) | Describe, Explain, Plan, Select: the LLM explains its failures to fix its plan, and a learned selector orders sub-goals by how reachable they are. | A learned "selector" that estimates how feasible a sub-goal is: close to using our world model as a filter (step 8). |
| **Ghost in the Minecraft (GITM)** (Zhu et al., 2023, arXiv 2305.17144) | The LLM breaks the goal into sub-goals, then into structured actions. It uses text memory and no learned control. It got the whole tech tree. | Shows that well-chosen structured actions do most of the work. |
| **Plan4MC** (Yuan et al., 2023, arXiv 2303.16563) | Basic skills learned with RL, plus a skill graph built by an LLM to plan long tasks. | Planning over a skill graph, like ours (with learned skills instead of written ones). |
| **JARVIS-1** (Wang et al., 2023, arXiv 2311.05997) | Multimodal planner plus memory of past successes (multimodal memory), on top of a pixel controller (STEVE-1). | Memory of experience to plan better, like the planned "structured memory". |
| **Optimus-1** (Li et al., NeurIPS 2024, arXiv 2408.03615) | Hybrid memory: a knowledge graph (the recipes) plus a store of past experiences, including failures. | Separates game facts from experience, as in CLAUDE.md. |
| **Project Sid** (Altera, 2024, arXiv 2411.00114) | Hundreds of LLM agents in one world: roles, economy, social rules. | The far end of multiple agents. Not a priority for us. |

## 2. World models (step 7 and beyond)

| Paper | Idea | For mc-agent |
|---|---|---|
| **DreamerV3** (Hafner et al., 2023, arXiv 2301.04104; Nature 2025) | A world model in latent space (RSSM: GRU plus discrete latents); the policy is learned inside its imagination. First agent to get diamonds from scratch, without human data. | The reference architecture for a latent world model (v2+). The RSSM is the GRU baseline mentioned for v2. |
| **Dreamer 4** (Hafner, Yan, Lillicrap, 2025, arXiv 2509.24527) | A transformer world model trained on offline video (from the VPT dataset); the agent learns entirely inside it and gets diamonds without playing online. | Shows that a world model trained only on recorded data can be enough. |
| **MineWorld** (Microsoft, 2025, arXiv 2504.08388) | A real-time interactive world model: a transformer predicts the next frames from the actions (pixels, tokenized). | Pixel world model, for "later". Also how they measure whether actions are followed. |
| **Oasis** (Decart & Etched, 2024, technical report) | A diffusion transformer that generates playable Minecraft in real time. It shows the limits: no lasting memory, the world changes when you look away. | Why a structured state and an explicit memory still help. |
| **Crafter** (Hafner, 2021, arXiv 2109.06780) and **Craftax** (Matthews et al., 2024, arXiv 2402.16801) | 2D "Minecraft-like" benchmarks: fast, many achievements to unlock; Craftax runs on GPU (JAX). | Somewhere fast to test a world model architecture before our slow real-time data. |

## 3. Learning from human data (pixels and keyboard/mouse)

| Paper | Idea | For mc-agent |
|---|---|---|
| **MineRL** (Guss et al., IJCAI 2019, arXiv 1907.13440) | 60 million frames of human play recorded with actions, plus the MineRL competitions (getting a diamond with little data). | An external dataset, already discussed (`docs/status.md` section 5). Its old Minecraft version and pixel actions differ from ours. |
| **MineRL BASALT** (Shah et al., 2021, arXiv 2107.01969) | Tasks with no reward ("build a waterfall"), judged by humans. | How to evaluate goals that cannot be checked by code (our `goal_reached` without a condition). |
| **VPT, Video PreTraining** (Baker et al., NeurIPS 2022, arXiv 2206.11795) | A small labeled dataset trains a model that guesses the actions (IDM). It then labels 70,000 hours of YouTube, which trains the policy. Got diamond tools. | Labeling unlabeled data with a learned model. Their dataset (contractor recordings) is the "VPT" of section 5. |
| **MineDojo** (Fan et al., NeurIPS 2022, arXiv 2206.08853) | Thousands of tasks, plus YouTube, wiki and Reddit data, plus **MineCLIP** (a video-text model used as a reward). | A text-video shared space: a version of the "shared latent space" goal. |
| **STEVE-1** (Lifshitz et al., NeurIPS 2023, arXiv 2306.00937) | VPT plus MineCLIP: a pixel controller that follows text instructions, trained cheaply. | A text-conditioned learned controller: a possible "learned source of action" (architecture.md). |
| **GROOT** (Cai et al., ICLR 2024, arXiv 2310.08235) and **ROCKET-1** (Cai et al., 2024, arXiv 2410.17856) | Controllers conditioned by a video example (GROOT) or by the segmentation of the target object (ROCKET-1). | Pointing at a target in space: like our spatial pointer at the target. |

## 4. Platforms and tools

| Name | What it is |
|---|---|
| **Malmo** (Johnson et al., IJCAI 2016) | Microsoft's first Minecraft research platform (Java mod). Historical. |
| **MineRL / MineDojo environments** | Gym environments on old Minecraft versions (1.11 / 1.16), with pixels and keyboard/mouse actions. |
| **MineStudio** (Cai et al., 2024, arXiv 2412.18293) | A toolkit that bundles the simulator, data, models (VPT, STEVE-1, GROOT, ROCKET), training and evaluation. |
| **Mineflayer** (PrismarineJS) | Our body: a protocol bot (not pixels), used by Voyager, Odyssey, MineLand and Mindcraft. |

## Suggested reading order

1. **Voyager**: the baseline we are compared to.
2. **Odyssey** or **Mindcraft**: what others do on the same stack.
3. **DEPS**: learning which plan step is feasible (our step 8).
4. **DreamerV3**, then **Dreamer 4**: world models that work in Minecraft.
5. **VPT**: using large amounts of external data.
