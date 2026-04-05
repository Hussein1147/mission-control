import { describe, it, expect } from "vitest";
import {
  sortByPriority,
  areDepsResolved,
  getAssignableTasks,
  assignTasksWithAffinity,
  buildTeamContext,
  findNewlyUnblockedTasks,
  detectCircularDependency,
  findDeadlockedTasks,
  shouldScaleUp,
  findAgentsToScaleDown,
  findAutoApprovableTasks,
  isProjectReadyForWork,
  shouldTransitionToRetro,
  getEligibleDeliberators,
  isDeliberationRoundComplete,
  isPhaseTimedOut,
} from "@/lib/orchestrator-logic";
import type { SharedTask, AgentConfig, AgentPoolConfig, ProjectConfig } from "@/lib/mission-control-data";

// --- Helpers to create test data ---

function makeTask(overrides: Partial<SharedTask> & { id: string; title: string }): SharedTask {
  return {
    description: "",
    assignee: "unassigned",
    status: "todo",
    priority: "P1",
    createdBy: "human",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentConfig> & { id: string; name: string }): AgentConfig {
  return {
    provider: "claude",
    role: "engineer",
    file: "agents/test.md",
    status: "idle",
    ...overrides,
  };
}

const defaultPoolConfig: AgentPoolConfig = {
  enabled: true,
  maxAgents: 4,
  providers: {
    claude: { maxInstances: 3, defaultModel: "claude-opus-4-6", defaultRole: "engineer" },
    codex: { maxInstances: 2, defaultRole: "engineer" },
  },
  scaleUpThreshold: 2,
  scaleDownAfterIdleMinutes: 10,
};

// ============================================================
// Feature 1: Priority-Based Assignment
// ============================================================

describe("Priority-Based Assignment", () => {
  it("sorts P0 before P1 before P2", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Low", priority: "P2" }),
      makeTask({ id: "t2", title: "Critical", priority: "P0" }),
      makeTask({ id: "t3", title: "Medium", priority: "P1" }),
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted.map((t) => t.priority)).toEqual(["P0", "P1", "P2"]);
  });

  it("preserves order within same priority (stable sort)", () => {
    const tasks = [
      makeTask({ id: "t1", title: "First P1", priority: "P1" }),
      makeTask({ id: "t2", title: "Second P1", priority: "P1" }),
      makeTask({ id: "t3", title: "Third P1", priority: "P1" }),
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not mutate the original array", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Low", priority: "P2" }),
      makeTask({ id: "t2", title: "High", priority: "P0" }),
    ];
    const sorted = sortByPriority(tasks);
    expect(tasks[0].id).toBe("t1"); // Original unchanged
    expect(sorted[0].id).toBe("t2"); // Sorted copy
  });

  it("handles empty array", () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it("handles single task", () => {
    const tasks = [makeTask({ id: "t1", title: "Only", priority: "P0" })];
    const sorted = sortByPriority(tasks);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("t1");
  });
});

// ============================================================
// Feature 2: Role/Agent Affinity
// ============================================================

describe("Role/Agent Affinity", () => {
  it("matches task preferredRole to agent role", () => {
    const engineer = makeAgent({ id: "a1", name: "Claude", role: "engineer" });
    const qa = makeAgent({ id: "a2", name: "QA Bot", role: "qa" });

    const tasks = [
      makeTask({ id: "t1", title: "Write tests", preferredRole: "qa" }),
      makeTask({ id: "t2", title: "Build feature", preferredRole: "engineer" }),
    ];

    const assignments = assignTasksWithAffinity(
      [engineer, qa],
      tasks,
      tasks,
      new Set()
    );

    expect(assignments).toHaveLength(2);
    // Engineer should get "Build feature" (preferredRole: engineer)
    const engineerAssignment = assignments.find((a) => a.agent.id === "a1");
    expect(engineerAssignment?.task.title).toBe("Build feature");
    // QA should get "Write tests" (preferredRole: qa)
    const qaAssignment = assignments.find((a) => a.agent.id === "a2");
    expect(qaAssignment?.task.title).toBe("Write tests");
  });

  it("falls back to any task when no role match", () => {
    const architect = makeAgent({ id: "a1", name: "Architect", role: "architect" });

    const tasks = [
      makeTask({ id: "t1", title: "Generic task" }), // No preferredRole
    ];

    const assignments = assignTasksWithAffinity(
      [architect],
      tasks,
      tasks,
      new Set()
    );

    expect(assignments).toHaveLength(1);
    expect(assignments[0].task.id).toBe("t1");
  });

  it("agent-specific assignment takes highest precedence", () => {
    const claude = makeAgent({ id: "claude", name: "Claude", role: "engineer" });

    const tasks = [
      makeTask({ id: "t1", title: "Role match", preferredRole: "engineer" }),
      makeTask({ id: "t2", title: "Assigned to Claude", assignee: "claude" }),
    ];

    const assignments = assignTasksWithAffinity(
      [claude],
      [tasks[0]], // Only t1 in the pool (t2 is agent-specific)
      tasks,
      new Set()
    );

    expect(assignments).toHaveLength(1);
    expect(assignments[0].task.id).toBe("t2"); // Agent-specific wins
  });

  it("handles no idle agents", () => {
    const tasks = [makeTask({ id: "t1", title: "Waiting" })];
    const assignments = assignTasksWithAffinity([], tasks, tasks, new Set());
    expect(assignments).toHaveLength(0);
  });

  it("handles no tasks", () => {
    const agent = makeAgent({ id: "a1", name: "Idle" });
    const assignments = assignTasksWithAffinity([agent], [], [], new Set());
    expect(assignments).toHaveLength(0);
  });

  it("does not assign more tasks than available", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Agent 1" }),
      makeAgent({ id: "a2", name: "Agent 2" }),
      makeAgent({ id: "a3", name: "Agent 3" }),
    ];
    const tasks = [makeTask({ id: "t1", title: "Only one task" })];

    const assignments = assignTasksWithAffinity(agents, tasks, tasks, new Set());
    expect(assignments).toHaveLength(1);
  });
});

// ============================================================
// Dependency Resolution
// ============================================================

describe("Dependency Resolution", () => {
  it("returns true when task has no dependencies", () => {
    const task = makeTask({ id: "t1", title: "No deps" });
    expect(areDepsResolved(task, [])).toBe(true);
  });

  it("returns true when task has empty dependsOn", () => {
    const task = makeTask({ id: "t1", title: "Empty deps", dependsOn: [] });
    expect(areDepsResolved(task, [])).toBe(true);
  });

  it("returns true when all deps are done", () => {
    const dep = makeTask({ id: "dep1", title: "Dep", status: "done" });
    const task = makeTask({ id: "t1", title: "Has dep", dependsOn: ["dep1"] });
    expect(areDepsResolved(task, [dep, task])).toBe(true);
  });

  it("returns false when a dep is not done", () => {
    const dep = makeTask({ id: "dep1", title: "Dep", status: "in_progress" });
    const task = makeTask({ id: "t1", title: "Has dep", dependsOn: ["dep1"] });
    expect(areDepsResolved(task, [dep, task])).toBe(false);
  });

  it("returns false when dep is in review", () => {
    const dep = makeTask({ id: "dep1", title: "Dep", status: "review" });
    const task = makeTask({ id: "t1", title: "Has dep", dependsOn: ["dep1"] });
    expect(areDepsResolved(task, [dep, task])).toBe(false);
  });

  it("returns false when dep does not exist", () => {
    const task = makeTask({ id: "t1", title: "Missing dep", dependsOn: ["nonexistent"] });
    expect(areDepsResolved(task, [task])).toBe(false);
  });

  it("handles multiple deps — all must be done", () => {
    const dep1 = makeTask({ id: "d1", title: "Dep 1", status: "done" });
    const dep2 = makeTask({ id: "d2", title: "Dep 2", status: "todo" });
    const task = makeTask({ id: "t1", title: "Multi dep", dependsOn: ["d1", "d2"] });
    expect(areDepsResolved(task, [dep1, dep2, task])).toBe(false);
  });
});

describe("getAssignableTasks", () => {
  it("filters out non-todo tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Todo", status: "todo" }),
      makeTask({ id: "t2", title: "In progress", status: "in_progress" }),
      makeTask({ id: "t3", title: "Done", status: "done" }),
    ];
    const result = getAssignableTasks(tasks, new Set());
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters out assigned tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Free", assignee: "unassigned" }),
      makeTask({ id: "t2", title: "Taken", assignee: "claude" }),
    ];
    const result = getAssignableTasks(tasks, new Set());
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters out blocked tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Free" }),
      makeTask({ id: "t2", title: "Blocked", blocked: true }),
    ];
    const result = getAssignableTasks(tasks, new Set());
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters out tasks with inactive project", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Active project", project: "proj-1" }),
      makeTask({ id: "t2", title: "Inactive project", project: "proj-2" }),
      makeTask({ id: "t3", title: "No project" }),
    ];
    const result = getAssignableTasks(tasks, new Set(["proj-1"]));
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("filters out tasks with unresolved deps", () => {
    const dep = makeTask({ id: "dep", title: "Dep", status: "todo" });
    const task = makeTask({ id: "t1", title: "Waiting", dependsOn: ["dep"] });
    const free = makeTask({ id: "t2", title: "Free" });
    const result = getAssignableTasks([dep, task, free], new Set());
    expect(result.map((t) => t.id)).toEqual(["dep", "t2"]);
  });
});

// ============================================================
// Feature 3: Cross-Agent Context
// ============================================================

describe("Cross-Agent Context", () => {
  it("shows what teammates are working on", () => {
    const agents: AgentConfig[] = [
      makeAgent({ id: "a1", name: "Claude", role: "engineer", currentTaskId: "t1", currentTaskTitle: "Build API" }),
      makeAgent({ id: "a2", name: "Codex", role: "engineer", currentTaskId: "t2", currentTaskTitle: "Write tests" }),
      makeAgent({ id: "a3", name: "QA", role: "qa" }), // No current task
    ];

    const context = buildTeamContext("a1", agents);
    expect(context).toContain("Codex");
    expect(context).toContain("Write tests");
    expect(context).not.toContain("Claude"); // Excludes current agent
    expect(context).not.toContain("QA"); // QA has no current task
  });

  it("returns default message when no teammates working", () => {
    const agents: AgentConfig[] = [
      makeAgent({ id: "a1", name: "Claude" }),
      makeAgent({ id: "a2", name: "Codex" }),
    ];
    const context = buildTeamContext("a1", agents);
    expect(context).toBe("No other agents are currently working.");
  });

  it("returns default when agent is the only one", () => {
    const agents: AgentConfig[] = [
      makeAgent({ id: "a1", name: "Claude", currentTaskId: "t1", currentTaskTitle: "Something" }),
    ];
    const context = buildTeamContext("a1", agents);
    expect(context).toBe("No other agents are currently working.");
  });
});

// ============================================================
// Feature 4: Dependency-Aware Notifications
// ============================================================

describe("Dependency-Aware Notifications", () => {
  it("finds tasks unblocked by completing a dependency", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Completed", status: "done" }),
      makeTask({ id: "t2", title: "Was waiting", status: "todo", dependsOn: ["t1"], blocked: true }),
    ];

    const unblocked = findNewlyUnblockedTasks("t1", tasks);
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe("t2");
  });

  it("does not unblock if other deps still pending", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Done", status: "done" }),
      makeTask({ id: "t2", title: "Still todo", status: "todo" }),
      makeTask({ id: "t3", title: "Waiting on both", status: "todo", dependsOn: ["t1", "t2"], blocked: true }),
    ];

    const unblocked = findNewlyUnblockedTasks("t1", tasks);
    expect(unblocked).toHaveLength(0);
  });

  it("unblocks multiple downstream tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Done", status: "done" }),
      makeTask({ id: "t2", title: "Waiting A", status: "todo", dependsOn: ["t1"] }),
      makeTask({ id: "t3", title: "Waiting B", status: "todo", dependsOn: ["t1"] }),
    ];

    const unblocked = findNewlyUnblockedTasks("t1", tasks);
    expect(unblocked).toHaveLength(2);
  });

  it("ignores tasks already done", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Done", status: "done" }),
      makeTask({ id: "t2", title: "Already done", status: "done", dependsOn: ["t1"] }),
    ];

    const unblocked = findNewlyUnblockedTasks("t1", tasks);
    expect(unblocked).toHaveLength(0);
  });

  it("ignores tasks that don't depend on the completed task", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Done", status: "done" }),
      makeTask({ id: "t2", title: "Depends on t3", status: "todo", dependsOn: ["t3"] }),
    ];

    const unblocked = findNewlyUnblockedTasks("t1", tasks);
    expect(unblocked).toHaveLength(0);
  });
});

// ============================================================
// Feature 5: Deadlock Detection
// ============================================================

describe("Deadlock Detection", () => {
  describe("detectCircularDependency", () => {
    it("detects simple A→B→A cycle", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", dependsOn: ["A"] }),
      ];
      expect(detectCircularDependency(tasks, "A", ["B"])).toBe(true);
    });

    it("detects longer A→B→C→A cycle", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", dependsOn: ["C"] }),
        makeTask({ id: "C", title: "C", dependsOn: ["A"] }),
      ];
      expect(detectCircularDependency(tasks, "A", ["B"])).toBe(true);
    });

    it("returns false for valid dependency chain", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", dependsOn: ["C"] }),
        makeTask({ id: "C", title: "C" }), // No deps, terminates chain
      ];
      expect(detectCircularDependency(tasks, "A", ["B"])).toBe(false);
    });

    it("returns false when no deps", () => {
      const tasks = [makeTask({ id: "A", title: "A" })];
      expect(detectCircularDependency(tasks, "A", [])).toBe(false);
    });
  });

  describe("findDeadlockedTasks", () => {
    it("finds deadlocked tasks in A↔B cycle", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", status: "todo", blocked: true, dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", status: "todo", blocked: true, dependsOn: ["A"] }),
      ];
      const deadlocked = findDeadlockedTasks(tasks);
      expect(deadlocked).toHaveLength(2);
    });

    it("returns empty when no deadlock", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", status: "todo", blocked: true, dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", status: "done" }),
      ];
      const deadlocked = findDeadlockedTasks(tasks);
      expect(deadlocked).toHaveLength(0);
    });

    it("returns empty when only one blocked task", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", status: "todo", blocked: true, dependsOn: ["B"] }),
      ];
      const deadlocked = findDeadlockedTasks(tasks);
      expect(deadlocked).toHaveLength(0);
    });

    it("returns empty when blocked tasks don't depend on each other", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", status: "todo", blocked: true, dependsOn: ["C"] }),
        makeTask({ id: "B", title: "B", status: "todo", blocked: true, dependsOn: ["D"] }),
      ];
      const deadlocked = findDeadlockedTasks(tasks);
      expect(deadlocked).toHaveLength(0);
    });

    it("ignores done tasks in cycle detection", () => {
      const tasks = [
        makeTask({ id: "A", title: "A", status: "done", dependsOn: ["B"] }),
        makeTask({ id: "B", title: "B", status: "done", dependsOn: ["A"] }),
      ];
      const deadlocked = findDeadlockedTasks(tasks);
      expect(deadlocked).toHaveLength(0);
    });
  });
});

// ============================================================
// Feature 6: Agent Pool Scaling
// ============================================================

describe("Agent Pool Scaling", () => {
  describe("shouldScaleUp", () => {
    it("returns null when pool scaling is disabled", () => {
      const config = { ...defaultPoolConfig, enabled: false };
      const agents = [makeAgent({ id: "a1", name: "Claude" })];
      expect(shouldScaleUp(config, agents, 5, new Set(["a1"]))).toBeNull();
    });

    it("returns null when idle agents exist", () => {
      const agents = [
        makeAgent({ id: "a1", name: "Claude", status: "idle" }),
      ];
      // a1 is idle (not in busyAgents)
      expect(shouldScaleUp(defaultPoolConfig, agents, 5, new Set())).toBeNull();
    });

    it("returns null when below scale-up threshold", () => {
      const agents = [
        makeAgent({ id: "a1", name: "Claude", status: "idle" }),
      ];
      // Only 1 unassigned task, threshold is 2
      expect(shouldScaleUp(defaultPoolConfig, agents, 1, new Set(["a1"]))).toBeNull();
    });

    it("returns null when at max agents", () => {
      const config = { ...defaultPoolConfig, maxAgents: 2 };
      const agents = [
        makeAgent({ id: "a1", name: "Claude" }),
        makeAgent({ id: "a2", name: "Codex", provider: "codex" as const }),
      ];
      expect(shouldScaleUp(config, agents, 5, new Set(["a1", "a2"]))).toBeNull();
    });

    it("recommends reactivating paused auto-scaled agent first", () => {
      const agents = [
        makeAgent({ id: "a1", name: "Claude" }),
        makeAgent({ id: "a2", name: "Claude-2", status: "paused", autoScaled: true }),
      ];
      const result = shouldScaleUp(defaultPoolConfig, agents, 3, new Set(["a1"]));
      expect(result).toEqual({ action: "reactivate", agent: agents[1] });
    });

    it("recommends creating new agent when no paused agents available", () => {
      const agents = [
        makeAgent({ id: "a1", name: "Claude" }),
      ];
      const result = shouldScaleUp(defaultPoolConfig, agents, 3, new Set(["a1"]));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("create");
      if (result!.action === "create") {
        expect(result!.provider).toBe("claude");
        expect(result!.defaultRole).toBe("engineer");
      }
    });

    it("skips provider at max instances", () => {
      const config: AgentPoolConfig = {
        ...defaultPoolConfig,
        providers: {
          claude: { maxInstances: 1, defaultRole: "engineer" },
          codex: { maxInstances: 2, defaultRole: "engineer" },
        },
      };
      const agents = [
        makeAgent({ id: "a1", name: "Claude", provider: "claude" }),
      ];
      const result = shouldScaleUp(config, agents, 3, new Set(["a1"]));
      expect(result).not.toBeNull();
      if (result?.action === "create") {
        expect(result.provider).toBe("codex"); // Claude is maxed, pick codex
      }
    });
  });

  describe("findAgentsToScaleDown", () => {
    it("finds idle auto-scaled agents past timeout", () => {
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude-2",
          autoScaled: true,
          status: "idle",
          lastActive: new Date(now - 15 * 60 * 1000).toISOString(), // 15 min ago
        }),
      ];
      const result = findAgentsToScaleDown(defaultPoolConfig, agents, new Set(), now);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a1");
    });

    it("ignores user-created agents", () => {
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude",
          autoScaled: false,
          status: "idle",
          lastActive: new Date(now - 15 * 60 * 1000).toISOString(),
        }),
      ];
      const result = findAgentsToScaleDown(defaultPoolConfig, agents, new Set(), now);
      expect(result).toHaveLength(0);
    });

    it("ignores busy agents", () => {
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude-2",
          autoScaled: true,
          status: "idle",
          lastActive: new Date(now - 15 * 60 * 1000).toISOString(),
        }),
      ];
      const result = findAgentsToScaleDown(defaultPoolConfig, agents, new Set(["a1"]), now);
      expect(result).toHaveLength(0);
    });

    it("ignores already paused agents", () => {
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude-2",
          autoScaled: true,
          status: "paused",
          lastActive: new Date(now - 15 * 60 * 1000).toISOString(),
        }),
      ];
      const result = findAgentsToScaleDown(defaultPoolConfig, agents, new Set(), now);
      expect(result).toHaveLength(0);
    });

    it("keeps agents within idle timeout", () => {
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude-2",
          autoScaled: true,
          status: "idle",
          lastActive: new Date(now - 5 * 60 * 1000).toISOString(), // Only 5 min, threshold is 10
        }),
      ];
      const result = findAgentsToScaleDown(defaultPoolConfig, agents, new Set(), now);
      expect(result).toHaveLength(0);
    });

    it("returns empty when scaling disabled", () => {
      const config = { ...defaultPoolConfig, enabled: false };
      const now = Date.now();
      const agents = [
        makeAgent({
          id: "a1",
          name: "Claude-2",
          autoScaled: true,
          status: "idle",
          lastActive: new Date(now - 15 * 60 * 1000).toISOString(),
        }),
      ];
      const result = findAgentsToScaleDown(config, agents, new Set(), now);
      expect(result).toHaveLength(0);
    });
  });
});

// ============================================================
// Feature 7: Auto-Approve Review Tasks
// ============================================================

describe("Auto-Approve Review Tasks", () => {
  it("finds tasks in review status", () => {
    const tasks = [
      makeTask({ id: "t1", title: "In review", status: "review" }),
      makeTask({ id: "t2", title: "Todo", status: "todo" }),
      makeTask({ id: "t3", title: "Done", status: "done" }),
      makeTask({ id: "t4", title: "Also review", status: "review" }),
    ];
    const approvable = findAutoApprovableTasks(tasks);
    expect(approvable).toHaveLength(2);
    expect(approvable.map((t) => t.id)).toEqual(["t1", "t4"]);
  });

  it("returns empty when no review tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Todo", status: "todo" }),
      makeTask({ id: "t2", title: "Done", status: "done" }),
    ];
    expect(findAutoApprovableTasks(tasks)).toHaveLength(0);
  });

  it("returns empty for empty task list", () => {
    expect(findAutoApprovableTasks([])).toHaveLength(0);
  });
});

// ============================================================
// Integration: Full Assignment Pipeline
// ============================================================

describe("Full Assignment Pipeline", () => {
  it("assigns P0 task to role-matched agent before P1 to fallback", () => {
    const engineer = makeAgent({ id: "eng", name: "Engineer", role: "engineer" });
    const qa = makeAgent({ id: "qa", name: "QA", role: "qa" });

    const tasks = [
      makeTask({ id: "t1", title: "Low priority QA", priority: "P2", preferredRole: "qa" }),
      makeTask({ id: "t2", title: "High priority eng", priority: "P0", preferredRole: "engineer" }),
      makeTask({ id: "t3", title: "Medium no pref", priority: "P1" }),
    ];

    // Sort by priority first
    const sorted = sortByPriority(tasks);
    expect(sorted.map((t) => t.priority)).toEqual(["P0", "P1", "P2"]);

    // Then assign with affinity
    const assignments = assignTasksWithAffinity(
      [engineer, qa],
      sorted,
      tasks,
      new Set()
    );

    expect(assignments).toHaveLength(2);
    // Engineer gets P0 eng task (role match)
    const engAssignment = assignments.find((a) => a.agent.id === "eng");
    expect(engAssignment?.task.title).toBe("High priority eng");
    // QA gets P2 qa task (role match, even though P1 generic is higher priority)
    const qaAssignment = assignments.find((a) => a.agent.id === "qa");
    expect(qaAssignment?.task.title).toBe("Low priority QA");
  });

  it("respects dependency chains — blocked tasks not assignable", () => {
    const tasks = [
      makeTask({ id: "t1", title: "First", status: "todo" }),
      makeTask({ id: "t2", title: "Second", status: "todo", dependsOn: ["t1"] }),
      makeTask({ id: "t3", title: "Third", status: "todo", dependsOn: ["t2"] }),
    ];

    const assignable = getAssignableTasks(tasks, new Set());
    // Only t1 is assignable — t2 and t3 have unresolved deps
    expect(assignable.map((t) => t.id)).toEqual(["t1"]);

    // After t1 completes
    tasks[0].status = "done";
    const afterT1 = getAssignableTasks(tasks, new Set());
    expect(afterT1.map((t) => t.id)).toEqual(["t2"]);

    // After t2 completes
    tasks[1].status = "done";
    const afterT2 = getAssignableTasks(tasks, new Set());
    expect(afterT2.map((t) => t.id)).toEqual(["t3"]);
  });
});

// ============================================================
// Project Phase Logic
// ============================================================

function makeProject(overrides: Partial<ProjectConfig> & { id: string; name: string }): ProjectConfig {
  return {
    description: "",
    color: "#8b5cf6",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Project Phase: isProjectReadyForWork", () => {
  it("returns true for tasks with no project", () => {
    const task = makeTask({ id: "t1", title: "No project" });
    expect(isProjectReadyForWork(task, [])).toBe(true);
  });

  it("returns true for active project in execution phase", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "execution" });
    const task = makeTask({ id: "t1", title: "Task", project: "p1" });
    expect(isProjectReadyForWork(task, [project])).toBe(true);
  });

  it("returns false for active project with no phase (must go through discovery first)", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active" });
    const task = makeTask({ id: "t1", title: "Task", project: "p1" });
    expect(isProjectReadyForWork(task, [project])).toBe(false);
  });

  it("returns false for project in discovery phase", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "discovery" });
    const task = makeTask({ id: "t1", title: "Task", project: "p1" });
    expect(isProjectReadyForWork(task, [project])).toBe(false);
  });

  it("returns false for project in retrospective phase", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "retrospective" });
    const task = makeTask({ id: "t1", title: "Task", project: "p1" });
    expect(isProjectReadyForWork(task, [project])).toBe(false);
  });

  it("returns false for draft project", () => {
    const project = makeProject({ id: "p1", name: "P", status: "draft", phase: "execution" });
    const task = makeTask({ id: "t1", title: "Task", project: "p1" });
    expect(isProjectReadyForWork(task, [project])).toBe(false);
  });
});

describe("Project Phase: shouldTransitionToRetro", () => {
  it("returns true when all tasks done and project in execution", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "execution" });
    const tasks = [
      makeTask({ id: "t1", title: "T1", project: "p1", status: "done" }),
      makeTask({ id: "t2", title: "T2", project: "p1", status: "done" }),
    ];
    expect(shouldTransitionToRetro(project, tasks)).toBe(true);
  });

  it("returns false when some tasks not done", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "execution" });
    const tasks = [
      makeTask({ id: "t1", title: "T1", project: "p1", status: "done" }),
      makeTask({ id: "t2", title: "T2", project: "p1", status: "in_progress" }),
    ];
    expect(shouldTransitionToRetro(project, tasks)).toBe(false);
  });

  it("returns false when project not active", () => {
    const project = makeProject({ id: "p1", name: "P", status: "draft", phase: "execution" });
    const tasks = [makeTask({ id: "t1", title: "T1", project: "p1", status: "done" })];
    expect(shouldTransitionToRetro(project, tasks)).toBe(false);
  });

  it("returns false when project in discovery phase", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "discovery" });
    const tasks = [makeTask({ id: "t1", title: "T1", project: "p1", status: "done" })];
    expect(shouldTransitionToRetro(project, tasks)).toBe(false);
  });

  it("returns false when project has no tasks", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active", phase: "execution" });
    expect(shouldTransitionToRetro(project, [])).toBe(false);
  });

  it("returns false for project with no phase (must be in execution to transition)", () => {
    const project = makeProject({ id: "p1", name: "P", status: "active" });
    const tasks = [makeTask({ id: "t1", title: "T1", project: "p1", status: "done" })];
    expect(shouldTransitionToRetro(project, tasks)).toBe(false);
  });
});

describe("Project Phase: getEligibleDeliberators", () => {
  it("excludes comms agents", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "Comms", role: "comms" }),
    ];
    const eligible = getEligibleDeliberators(agents, [], new Set());
    expect(eligible.map((a) => a.id)).toEqual(["a1"]);
  });

  it("excludes agents who already contributed", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "QA", role: "qa" }),
    ];
    const eligible = getEligibleDeliberators(agents, ["a1"], new Set());
    expect(eligible.map((a) => a.id)).toEqual(["a2"]);
  });

  it("excludes busy agents", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "QA", role: "qa" }),
    ];
    const eligible = getEligibleDeliberators(agents, [], new Set(["a1"]));
    expect(eligible.map((a) => a.id)).toEqual(["a2"]);
  });

  it("excludes paused agents", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer", status: "paused" }),
      makeAgent({ id: "a2", name: "QA", role: "qa" }),
    ];
    const eligible = getEligibleDeliberators(agents, [], new Set());
    expect(eligible.map((a) => a.id)).toEqual(["a2"]);
  });

  it("sorts by role priority: architect first", () => {
    const agents = [
      makeAgent({ id: "a1", name: "QA", role: "qa" }),
      makeAgent({ id: "a2", name: "Architect", role: "architect" }),
      makeAgent({ id: "a3", name: "Engineer", role: "engineer" }),
    ];
    const eligible = getEligibleDeliberators(agents, [], new Set());
    expect(eligible.map((a) => a.role)).toEqual(["architect", "engineer", "qa"]);
  });
});

describe("Project Phase: isDeliberationRoundComplete", () => {
  it("returns true when all eligible agents contributed", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "QA", role: "qa" }),
      makeAgent({ id: "a3", name: "Comms", role: "comms" }), // excluded
    ];
    expect(isDeliberationRoundComplete(agents, ["a1", "a2"])).toBe(true);
  });

  it("returns false when some agents haven't contributed", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "QA", role: "qa" }),
    ];
    expect(isDeliberationRoundComplete(agents, ["a1"])).toBe(false);
  });

  it("ignores paused agents", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Engineer", role: "engineer" }),
      makeAgent({ id: "a2", name: "QA", role: "qa", status: "paused" }),
    ];
    expect(isDeliberationRoundComplete(agents, ["a1"])).toBe(true);
  });
});

describe("Project Phase: isPhaseTimedOut", () => {
  it("returns true after 15 minutes", () => {
    const started = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    expect(isPhaseTimedOut(started)).toBe(true);
  });

  it("returns false within 15 minutes", () => {
    const started = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(isPhaseTimedOut(started)).toBe(false);
  });

  it("respects custom timeout", () => {
    const started = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    expect(isPhaseTimedOut(started, Date.now(), 2 * 60 * 1000)).toBe(true);
  });
});
