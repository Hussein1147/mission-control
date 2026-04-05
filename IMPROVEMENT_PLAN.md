# Mission Control Improvement Plan
## Extracted from Andrej Karpathy / Sarah Guo conversation (No Priors)

---

## Core Insight: Remove the Human as Bottleneck

> "The name of the game now is to increase your leverage. I put in just very few tokens just once in a while and a huge amount of stuff happens on my behalf."

Mission Control should maximize **token throughput** — the amount of useful agent work happening per unit of human attention.

---

## 1. Parallel Agent Orchestration (Peter Szilagyi Model)

**Current state:** One orchestrator loop assigns one task at a time to idle agents.

**Improvement:** Enable multiple agents to work simultaneously on non-interfering tasks across repos/projects.

- Show a **tiled agent view** — like Peter's monitor setup — showing all active agent sessions in real-time
- Add agent **concurrency controls**: how many agents can run in parallel
- The orchestrator should batch-assign: give each idle agent a task simultaneously, not sequentially
- Track **token throughput** as a metric: tokens consumed per hour, visible in the dashboard
- Show which agents are idle (wasted capacity) vs working — nudge the user when agents are underutilized

**Priority: P0** — This is the core multiplier.

---

## 2. Autonomous Long-Running Loops (Auto Research Pattern)

**Current state:** Agents do one task, return result, wait for next assignment.

**Improvement:** Support **autonomous loops** where an agent works continuously on an objective without human involvement.

- New task type: **"Loop task"** — has an objective + metric + boundaries, runs repeatedly
- Agent trains/experiments/iterates in a loop, logging progress to the task
- Human reviews periodically, not after every step
- Example: "Optimize this function's performance" → agent runs benchmarks, tries improvements, logs results
- Show a **progress timeline** for loop tasks — each iteration as a data point

**Priority: P1** — This is the path to auto research.

---

## 3. Better Agent Memory & Persistence (Claude-like Entities)

**Current state:** Agents get context via prompt injection each task. No persistent memory across tasks.

**Improvement:** Give agents persistent, sophisticated memory that accumulates over time.

- Each agent's `.md` file should grow as they work — agents should **write back** learnings, patterns discovered, codebase knowledge
- Add a **memory retrieval system** — when starting a task, pull relevant memories from past tasks (Smart Memory integration is partially there)
- Agents should remember what they learned from previous tasks in the same project
- Cross-agent memory sharing — if Claude learns something about the codebase, Codex should benefit

**Priority: P1** — Directly impacts agent effectiveness over time.

---

## 4. Agent Personality & Teammate Feel

> "Claude has a pretty good personality. It feels like a teammate. Codex is a lot more dry. It doesn't seem to care about what you're creating."

**Improvement:** Make agents feel like engaged teammates, not just task executors.

- Enhance agent instruction files with personality guidance
- Agents should express understanding of the **bigger picture** — why the project matters
- When completing a task, agents should connect their work to project goals
- In channel messages, agents should be conversational and contextual, not just transactional
- Consider: agents celebrating project milestones in channels

**Priority: P2** — Quality of life, but affects user engagement significantly.

---

## 5. Token Throughput Dashboard

> "I feel nervous when I have subscription left over. That just means I haven't maximized my token throughput."

**Improvement:** Add a **throughput dashboard** showing:

- Tokens consumed per agent per hour
- Agent utilization rate (working time vs idle time)
- Tasks completed per day/week
- Time-to-completion trends
- **Idle agent alerts** — "Claude has been idle for 5 minutes, 3 tasks in backlog"

**Priority: P1** — Visibility drives optimization behavior.

---

## 6. Project → Auto-Decomposition → Auto-Execution Pipeline

**Current state:** (Just implemented) Projects auto-generate backlogs, activation switch controls when agents start.

**Improvement:** Close the loop — make the entire pipeline more autonomous:

- After activation, the orchestrator should **re-plan** if it discovers new information during execution
- If an agent finds that a task needs to be split, it should be able to **create sub-tasks** autonomously
- If all tasks in a project are done, auto-mark project as completed and notify the human
- If a task's dependencies are all blocked, escalate to human automatically via channel
- Add **project-level progress reports** — agents summarize project status periodically in the project's channel

**Priority: P1** — Makes the system more self-managing.

---

## 7. Macro Actions Over Repositories

> "You can move in much larger macro actions. It's not just here's a line of code, here's a new function. It's like here's a new functionality."

**Improvement:** The task creation and description should encourage **macro-level thinking**.

- Task templates for common macro actions: "Add feature X", "Refactor module Y", "Write tests for Z", "Investigate bug in W"
- When generating backlogs, bias toward larger, meaningful tasks rather than micro-tasks
- Allow agents to propose their own task breakdowns — "I think this should be 3 sub-tasks"

**Priority: P2** — Improves task quality.

---

## 8. Multi-Provider Agent Rotation

> "If you run out of the quota on Codex, you should switch to Claude or what not."

**Improvement:** The orchestrator should be aware of rate limits and rotate between providers.

- Track rate limit status per provider
- If Claude is rate-limited, automatically route tasks to Codex (and vice versa)
- Show provider status in the dashboard — which providers are available, rate-limited, or down
- Allow fallback chains: Claude → Codex → local model

**Priority: P2** — Maximizes uptime and throughput.

---

## 9. Untrusted Worker Pool (Future Vision)

> "A swarm of agents on the internet could collaborate to improve LLMs."

**Long-term vision:** Allow external contributors to submit solutions to tasks.

- Tasks with clear metrics could accept external submissions
- Verification layer checks that submissions meet criteria
- Could extend to open-source projects where community members contribute via agents

**Priority: P3** — Future architecture consideration.

---

## 10. API-First Design for Agent Interaction

> "Shouldn't it just be APIs and shouldn't agents be just using it directly?"

**Improvement:** Every feature in Mission Control should have a clean API that agents can use.

- Agents should be able to create tasks, update projects, post to channels programmatically
- The orchestrator already uses APIs — but agents themselves should have API access documented in their instructions
- Consider: agents should be able to trigger other agents via the API (not just through the orchestrator)

**Priority: P1** — Foundation for autonomous operation.

---

## Implementation Priorities

### Immediate (Next Sprint)
1. Parallel agent orchestration — batch assignment in tick()
2. Token throughput dashboard — basic metrics on the task board
3. Agent self-memory — agents write back to their .md files after tasks

### Short-term (2-4 weeks)
4. Autonomous loop tasks
5. Project auto-completion and re-planning
6. Multi-provider rotation
7. Agent personality improvements

### Medium-term (1-2 months)
8. Macro action templates
9. API-first agent access documentation
10. Untrusted worker pool architecture
