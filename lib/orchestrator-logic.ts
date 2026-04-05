/**
 * Pure, testable orchestrator logic functions.
 * Extracted from orchestrator.ts so they can be unit-tested without
 * spawning real agents or hitting real APIs.
 */

import type { SharedTask, AgentConfig, AgentPoolConfig, ProjectConfig, ProjectPhaseMetadata } from "./mission-control-data";

// --- Priority-Based Assignment ---

/**
 * Sort tasks by priority: P0 first, then P1, then P2.
 * Stable sort — same-priority tasks keep original order.
 */
export function sortByPriority(tasks: SharedTask[]): SharedTask[] {
  return [...tasks].sort((a, b) => a.priority.localeCompare(b.priority));
}

// --- Dependency Resolution ---

/**
 * Check if all dependencies of a task are resolved (status === "done").
 */
export function areDepsResolved(task: SharedTask, allTasks: SharedTask[]): boolean {
  if (!task.dependsOn?.length) return true;
  return task.dependsOn.every((depId) => {
    const dep = allTasks.find((d) => d.id === depId);
    return dep?.status === "done";
  });
}

/**
 * Filter tasks to only those assignable: todo, unassigned, not blocked,
 * project active, and all dependencies resolved.
 */
export function getAssignableTasks(
  tasks: SharedTask[],
  activeProjectIds: Set<string>
): SharedTask[] {
  return tasks.filter((t) => {
    if (t.status !== "todo") return false;
    if (t.assignee !== "unassigned") return false;
    if (t.blocked) return false;
    // Project must be active or task has no project
    if (t.project && !activeProjectIds.has(t.project)) return false;
    // All deps must be done
    if (!areDepsResolved(t, tasks)) return false;
    return true;
  });
}

// --- Role/Agent Affinity ---

/**
 * Assign tasks to agents with role affinity.
 * Returns array of [agent, task] pairs.
 *
 * Priority:
 * 1. Agent has a task specifically assigned to them (task.assignee === agent.id)
 * 2. Task has preferredRole matching agent.role
 * 3. Fallback: next task from the sorted queue
 */
export function assignTasksWithAffinity(
  idleAgents: AgentConfig[],
  todoTasks: SharedTask[],
  allTasks: SharedTask[],
  activeProjectIds: Set<string>
): Array<{ agent: AgentConfig; task: SharedTask }> {
  const assignments: Array<{ agent: AgentConfig; task: SharedTask }> = [];
  const availableTasks = [...todoTasks]; // Don't mutate input

  for (const agent of idleAgents) {
    // 1. Check for agent-specific assignment
    const assignedTask = allTasks.find(
      (t) =>
        t.assignee === agent.id &&
        t.status === "todo" &&
        !t.blocked &&
        (!t.project || activeProjectIds.has(t.project)) &&
        areDepsResolved(t, allTasks)
    );

    let task = assignedTask;

    if (!task) {
      // 2. Try role affinity match
      const affinityIdx = availableTasks.findIndex(
        (t) => t.preferredRole === agent.role
      );
      if (affinityIdx !== -1) {
        task = availableTasks.splice(affinityIdx, 1)[0];
      } else {
        // 3. Fallback: next from queue
        task = availableTasks.shift();
      }
    }

    if (task) {
      assignments.push({ agent, task });
    }
  }

  return assignments;
}

// --- Cross-Agent Context ---

/**
 * Build a string describing what teammates are currently working on.
 */
export function buildTeamContext(
  currentAgentId: string,
  allAgents: AgentConfig[]
): string {
  const teammates = allAgents
    .filter((a) => a.id !== currentAgentId && a.currentTaskId)
    .map((a) => `- ${a.name} (${a.role}) is working on "${a.currentTaskTitle}"`)
    .join("\n");
  return teammates || "No other agents are currently working.";
}

// --- Dependency-Aware Notifications ---

/**
 * Find tasks that should be unblocked after a task is completed.
 * Returns tasks whose dependencies are now all resolved.
 */
export function findNewlyUnblockedTasks(
  completedTaskId: string,
  allTasks: SharedTask[]
): SharedTask[] {
  const unblocked: SharedTask[] = [];

  for (const task of allTasks) {
    if (!task.dependsOn?.includes(completedTaskId)) continue;
    if (task.status === "done") continue;

    // Check if ALL deps are now resolved (treating the completed task as done)
    const allDepsResolved = task.dependsOn.every((depId) => {
      if (depId === completedTaskId) return true; // This one just completed
      const dep = allTasks.find((d) => d.id === depId);
      return dep?.status === "done";
    });

    if (allDepsResolved) {
      unblocked.push(task);
    }
  }

  return unblocked;
}

// --- Deadlock Detection ---

/**
 * Detect circular dependencies using DFS.
 * Returns true if taskId can be reached by following dependsOn chains from its own dependencies.
 */
export function detectCircularDependency(
  tasks: SharedTask[],
  taskId: string,
  dependsOn: string[]
): boolean {
  const visited = new Set<string>();
  const stack = [...dependsOn];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const found = tasks.find((t) => t.id === current);
    if (found?.dependsOn) stack.push(...found.dependsOn);
  }
  return false;
}

/**
 * Find groups of tasks that are deadlocked (blocked in a cycle).
 * Returns the set of deadlocked task IDs, or empty set if no deadlock.
 */
export function findDeadlockedTasks(tasks: SharedTask[]): SharedTask[] {
  const blockedWithDeps = tasks.filter(
    (t) =>
      (t.status === "todo" || t.status === "in_progress") &&
      t.blocked &&
      t.dependsOn?.length
  );
  if (blockedWithDeps.length < 2) return [];

  const blockedIds = new Set(blockedWithDeps.map((t) => t.id));
  const deadlocked = blockedWithDeps.filter((t) =>
    t.dependsOn!.some((depId) => blockedIds.has(depId))
  );
  if (deadlocked.length < 2) return [];

  const cycle = detectCircularDependency(
    tasks,
    deadlocked[0].id,
    deadlocked[0].dependsOn || []
  );
  return cycle ? deadlocked : [];
}

// --- Agent Pool Scaling ---

/**
 * Determine if the agent pool should scale up.
 * Returns the provider to scale up, or null if no scaling needed.
 */
export function shouldScaleUp(
  config: AgentPoolConfig,
  agents: AgentConfig[],
  unassignedTaskCount: number,
  busyAgentIds: Set<string>
): { action: "reactivate"; agent: AgentConfig } | { action: "create"; provider: string; defaultModel?: string; defaultRole: string } | null {
  if (!config.enabled) return null;

  const activeAgents = agents.filter((a) => a.status !== "paused");
  const idleAgents = activeAgents.filter((a) => !busyAgentIds.has(a.id));

  if (
    unassignedTaskCount < config.scaleUpThreshold ||
    idleAgents.length > 0 ||
    activeAgents.length >= config.maxAgents
  ) {
    return null;
  }

  // Try to reactivate a paused auto-scaled agent first
  const pausedAutoScaled = agents.find(
    (a) => a.status === "paused" && a.autoScaled
  );
  if (pausedAutoScaled) {
    return { action: "reactivate", agent: pausedAutoScaled };
  }

  // Find a provider with capacity
  for (const [provider, providerConfig] of Object.entries(config.providers)) {
    const providerAgents = activeAgents.filter((a) => a.provider === provider);
    if (providerAgents.length >= providerConfig.maxInstances) continue;
    return {
      action: "create",
      provider,
      defaultModel: providerConfig.defaultModel,
      defaultRole: providerConfig.defaultRole,
    };
  }

  return null;
}

/**
 * Find auto-scaled agents that should be paused due to idle timeout.
 */
export function findAgentsToScaleDown(
  config: AgentPoolConfig,
  agents: AgentConfig[],
  busyAgentIds: Set<string>,
  nowMs: number
): AgentConfig[] {
  if (!config.enabled) return [];

  const idleTimeoutMs = config.scaleDownAfterIdleMinutes * 60 * 1000;
  return agents.filter((a) => {
    if (!a.autoScaled) return false;
    if (a.status === "paused") return false;
    if (busyAgentIds.has(a.id)) return false;
    if (!a.lastActive) return false;
    const idleFor = nowMs - new Date(a.lastActive).getTime();
    return idleFor > idleTimeoutMs;
  });
}

// --- Auto-Approve ---

/**
 * Find tasks in "review" status that should be auto-approved to "done".
 */
export function findAutoApprovableTasks(tasks: SharedTask[]): SharedTask[] {
  return tasks.filter((t) => t.status === "review");
}

// --- Project Phase Logic ---

/**
 * Check if a project is ready for task assignment.
 * Tasks should only be assigned for active projects in execution phase.
 */
export function isProjectReadyForWork(
  task: SharedTask,
  projects: ProjectConfig[]
): boolean {
  if (!task.project) return true;
  const proj = projects.find((p) => p.id === task.project);
  if (!proj) return true;
  return proj.status === "active" && proj.phase === "execution";
}

/**
 * Determine if a project should transition to retrospective.
 * Returns true if project is active, in execution phase, and all tasks are done.
 */
export function shouldTransitionToRetro(
  project: ProjectConfig,
  tasks: SharedTask[]
): boolean {
  if (project.status !== "active") return false;
  if (project.phase !== "execution") return false;
  const projectTasks = tasks.filter((t) => t.project === project.id);
  if (projectTasks.length === 0) return false;
  return projectTasks.every((t) => t.status === "done");
}

/**
 * Get eligible agents for a deliberation round.
 * Excludes comms agents and those who already contributed this round.
 * Returns agents sorted by deliberation priority: architect → researcher → engineer → qa → ops.
 */
export function getEligibleDeliberators(
  agents: AgentConfig[],
  contributedAgentIds: string[],
  busyAgentIds: Set<string>
): AgentConfig[] {
  const eligible = agents.filter(
    (a) =>
      a.status !== "paused" &&
      a.role !== "comms" &&
      !contributedAgentIds.includes(a.id) &&
      !busyAgentIds.has(a.id)
  );
  const roleOrder = ["architect", "researcher", "engineer", "qa", "ops"];
  return eligible.sort(
    (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role)
  );
}

/**
 * Check if a deliberation round is complete (all eligible agents have contributed).
 */
export function isDeliberationRoundComplete(
  allAgents: AgentConfig[],
  contributedAgentIds: string[]
): boolean {
  const eligible = allAgents.filter(
    (a) => a.status !== "paused" && a.role !== "comms"
  );
  return eligible.every((a) => contributedAgentIds.includes(a.id));
}

/**
 * Check if a deliberation phase has timed out (>15 minutes).
 */
export function isPhaseTimedOut(
  phaseStartedAt: string,
  nowMs: number = Date.now(),
  timeoutMs: number = 15 * 60 * 1000
): boolean {
  return nowMs - new Date(phaseStartedAt).getTime() > timeoutMs;
}
