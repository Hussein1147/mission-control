#!/usr/bin/env npx tsx
/**
 * Mission Control Orchestrator
 *
 * Spawns Claude and Codex CLI agents, assigns tasks from the shared board,
 * relays messages between agents, and logs all activity.
 *
 * Usage: npx tsx orchestrator.ts
 *
 * Requires:
 * - Mission Control running at localhost:3000 (npm run dev)
 * - Claude Code CLI (npx @anthropic-ai/claude-code)
 * - Codex CLI (codex)
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildCodexExecArgs } from "@/lib/agent-command-config";
import type { SharedTask, AgentConfig, AgentMessage, ChannelMessage, ProjectConfig, ProjectPhaseMetadata, DocEntry, TaskAttachment, AgentPoolConfig, ProviderPoolConfig, LoopConfig, LoopIteration } from "@/lib/mission-control-data";

const API_BASE = "http://127.0.0.1:3000/api";
const SMART_MEMORY_BASE = "http://127.0.0.1:8000";
const POLL_INTERVAL = 10_000; // 10 seconds
const PROJECT_ROOT = path.resolve(import.meta.dirname || ".");
let smartMemoryAvailable = false;

// --- API Helpers ---

async function api<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${endpoint}`, opts);
  return res.json() as Promise<T>;
}

// --- Smart Memory Helpers ---

async function smartMemory<T>(endpoint: string, method = "GET", body?: unknown): Promise<T | null> {
  if (!smartMemoryAvailable) return null;
  try {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SMART_MEMORY_BASE}${endpoint}`, opts);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function checkSmartMemory(): Promise<boolean> {
  try {
    const res = await fetch(`${SMART_MEMORY_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function retrieveMemories(agentId: string, query: string, crossAgent = true): Promise<string> {
  // Use empty entity_scope for cross-agent retrieval (all agents' memories)
  // or scope to specific agent when needed
  const entityScope = crossAgent ? [] : [agentId];
  const result = await smartMemory<{
    selected?: { memory: { content: string }; final_score: number }[];
    candidates?: { content: string; importance: number }[];
  }>("/retrieve", "POST", {
    user_message: query,
    conversation_history: "",
    include_history: false,
    entity_scope: entityScope,
  });

  // Prefer reranked `selected` results over raw `candidates`
  if (result?.selected?.length) {
    return result.selected
      .map((s) => `- ${s.memory.content}`)
      .join("\n");
  }
  // Fallback to candidates if selected not available
  if (result?.candidates?.length) {
    return result.candidates
      .map((c) => `- ${c.content}`)
      .join("\n");
  }
  return "";
}

async function ingestToSmartMemory(agentId: string, sessionId: string, taskTitle: string, userMsg: string, assistantMsg: string): Promise<void> {
  await smartMemory("/ingest", "POST", {
    user_message: `[Task: ${taskTitle}] ${userMsg}`,
    assistant_message: assistantMsg,
    source_session_id: sessionId,
    timestamp: new Date().toISOString(),
  });
}

// Types imported from @/lib/mission-control-data

// --- Agent Spawning ---

const busyAgents = new Set<string>();
const processedChannelMessages = new Set<string>(); // track handled channel messages
const reportedDeadlocks = new Set<string>(); // deduplicate deadlock alerts
const deliberatingProjects = new Set<string>(); // projects currently in deliberation (discovery/retro)
const notifiedBlockers = new Set<string>(); // deduplicate blocker notifications (taskId or projectId+reason)
const lastProjectSummary = new Map<string, string>(); // project ID → last posted summary text (dedup)
let lastIdleAlertTime = 0; // ms timestamp for deduplicating idle alerts
const orchestratorStartTime = new Date().toISOString(); // ignore messages from before startup
let tickCount = 0; // counter for periodic summaries

// --- Provider Health Tracking ---
const providerStatus: Record<string, { rateLimited: boolean; retryAfter: number; consecutiveErrors: number; lastError?: string }> = {};

/** Check if an agent's response is actually an error (timeout, crash, rate limit) */
function isAgentError(result: string): boolean {
  if (!result || result.trim().length === 0) return true;
  if (/^Error\s*\(exit\s+\d+\)\s*:?\s*$/i.test(result.trim())) return true;
  if (/^Error\s*\(exit\s+null\)\s*:?\s*/i.test(result.trim())) return true;
  // Short error-only responses (no meaningful content)
  if (result.trim().length < 100 && /^(Error|error|ERROR)/.test(result.trim())) return true;
  return false;
}

function isProviderHealthy(provider: string): boolean {
  const status = providerStatus[provider];
  if (!status) return true;
  if (status.rateLimited && Date.now() < status.retryAfter) return false;
  if (status.consecutiveErrors >= 3) return false;
  return true;
}

function markProviderError(provider: string, error: string) {
  if (!providerStatus[provider]) {
    providerStatus[provider] = { rateLimited: false, retryAfter: 0, consecutiveErrors: 0 };
  }
  const s = providerStatus[provider];
  s.consecutiveErrors++;
  s.lastError = error;
  if (/rate.?limit|429|too many requests/i.test(error)) {
    s.rateLimited = true;
    s.retryAfter = Date.now() + 60_000; // retry after 1 minute
    console.log(`[Provider] ${provider} rate-limited, retrying after 60s`);
  }
}

function markProviderSuccess(provider: string) {
  providerStatus[provider] = { rateLimited: false, retryAfter: 0, consecutiveErrors: 0 };
}

async function readAgentMemory(agentFile: string): Promise<string> {
  try {
    const filePath = path.join(PROJECT_ROOT, agentFile);
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function writeAgentLearning(agentFile: string, taskTitle: string, result: string): Promise<void> {
  try {
    const filePath = path.join(PROJECT_ROOT, agentFile);
    let content = await fs.readFile(filePath, "utf-8");

    // Extract first 150 chars of result as a summary
    const summary = result.replace(/\n/g, " ").slice(0, 150).trim();
    const date = new Date().toISOString().slice(0, 10);
    const entry = `- [${date}] ${taskTitle}: ${summary}`;

    const learningsHeader = "## Learnings";
    const idx = content.indexOf(learningsHeader);

    if (idx === -1) {
      // Add new Learnings section at end
      content = content.trimEnd() + `\n\n${learningsHeader}\n${entry}\n`;
    } else {
      // Insert entry after header
      const afterHeader = idx + learningsHeader.length;
      const before = content.slice(0, afterHeader);
      const after = content.slice(afterHeader);
      content = before + `\n${entry}` + after;
    }

    // Cap learnings at 20 entries
    const lines = content.split("\n");
    const learningLines = lines.filter((l) => l.match(/^- \[\d{4}-\d{2}-\d{2}\]/));
    if (learningLines.length > 20) {
      // Remove oldest entries (they appear first)
      const excess = learningLines.length - 20;
      let removed = 0;
      const filtered = lines.filter((l) => {
        if (removed < excess && l.match(/^- \[\d{4}-\d{2}-\d{2}\]/)) {
          removed++;
          return false;
        }
        return true;
      });
      content = filtered.join("\n");
    }

    await fs.writeFile(filePath, content, "utf-8");
    console.log(`  [Memory] Wrote learning to ${agentFile}`);
  } catch (err) {
    console.error(`  [Memory] Failed to write learning: ${err}`);
  }
}

async function readRoleInstructions(roleId: string): Promise<string> {
  try {
    const filePath = path.join(PROJECT_ROOT, "roles", `${roleId}.md`);
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function buildPrompt(task: SharedTask, messages: AgentMessage[], agentMemory: string, roleInstructions: string, smartMemoryContext: string, teamContext = ""): Promise<string> {
  const parts: string[] = [];

  if (roleInstructions) {
    parts.push(`=== ROLE INSTRUCTIONS ===\n${roleInstructions}`);
  }
  if (agentMemory) {
    parts.push(`=== AGENT IDENTITY ===\n${agentMemory}`);
  }
  if (smartMemoryContext) {
    parts.push(`=== RELEVANT MEMORIES ===\n${smartMemoryContext}`);
  }

  // Cross-agent learnings: include recent learnings from other agents
  try {
    const agentsDir = path.join(PROJECT_ROOT, "agents");
    const files = await fs.readdir(agentsDir);
    const teamLearnings: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
      const idx = content.indexOf("## Learnings");
      if (idx === -1) continue;
      const learningsSection = content.slice(idx + "## Learnings".length);
      const entries = learningsSection.split("\n").filter((l) => l.match(/^- \[\d{4}-\d{2}-\d{2}\]/));
      // Take last 3 from each agent
      teamLearnings.push(...entries.slice(-3));
    }
    if (teamLearnings.length > 0) {
      parts.push(`=== TEAM LEARNINGS ===\nRecent learnings from the team:\n${teamLearnings.slice(-5).join("\n")}`);
    }
  } catch {}
  if (teamContext) {
    parts.push(`=== ACTIVE TEAMMATES ===\n${teamContext}\nCoordinate your work to avoid conflicts with ongoing tasks.`);
  }
  if (messages.length > 0) {
    const msgText = messages.map((m) => `[${m.from}]: ${m.content}`).join("\n");
    parts.push(`=== MESSAGES FROM OTHER AGENTS ===\n${msgText}`);
  }

  parts.push(`=== TASK ===\nTitle: ${task.title}\nPriority: ${task.priority}\nDescription: ${task.description}`);

  // Task-level attachments
  if (task.attachments && task.attachments.length > 0) {
    const attachList = task.attachments.map((a) => {
      if (a.type === "file") return `- ${a.name} (uploaded file: ${path.join(PROJECT_ROOT, a.path)})`;
      return `- ${a.name} (local path: ${a.path})`;
    }).join("\n");
    parts.push(`=== TASK ATTACHMENTS ===\nThe following files are attached to this task. You can read them to get more context.\n${attachList}`);
  }

  // Project-level attachments — fetch if task belongs to a project
  if (task.project) {
    try {
      const projects = await api<ProjectConfig[]>("/projects");
      const proj = projects.find((p) => p.id === task.project);
      if (proj) {
        parts.push(`=== PROJECT ===\nThis task belongs to project "${proj.name}": ${proj.description}`);
        if (proj.attachments && proj.attachments.length > 0) {
          const projFiles = proj.attachments.map((a) => {
            if (a.type === "file") return `- ${a.name} (uploaded file: ${path.join(PROJECT_ROOT, a.path)})`;
            return `- ${a.name} (local path: ${a.path})`;
          }).join("\n");
          parts.push(`=== PROJECT FILES ===\nThe project has these files attached. Refer to them for additional context.\n${projFiles}`);
        }
        // Include context from dependent projects
        if (proj.dependsOn?.length) {
          const depContext = await buildDependentProjectContext(proj);
          if (depContext) parts.push(depContext);
        }
      }
    } catch {}
  }

  // Task dependencies
  if (task.dependsOn && task.dependsOn.length > 0) {
    try {
      const allTasks = await api<SharedTask[]>("/tasks");
      const depLines = task.dependsOn.map((depId) => {
        const dep = allTasks.find((t) => t.id === depId);
        if (!dep) return `- Unknown task (${depId})`;
        const done = dep.status === "done";
        return `- "${dep.title}" (${dep.status})${done ? " ✓" : " ⏳ WAITING"}`;
      }).join("\n");
      parts.push(`=== DEPENDENCIES ===\nThis task depends on:\n${depLines}\nIf any dependency is not done, you should mark this task as blocked.`);
    } catch {}
  }

  parts.push(`\nComplete this task. Be concise in your response. Summarize what you did and any results.\n\nNote: When you finish, the orchestrator will move this task to "review". If you think it should go directly to "done", say "STATUS: done" in your response.\nIf you cannot complete this task because you are blocked (missing dependency, waiting for another task, need human input, etc.), say "STATUS: blocked REASON: <explain why>" in your response.`);

  return parts.join("\n\n");
}

// Track all spawned child processes for cleanup on shutdown
const activeChildProcesses = new Set<ReturnType<typeof spawn>>();

/**
 * Spawn a CLI process and pipe the prompt via stdin.
 * This avoids shell escaping issues with special characters in prompts.
 */
const DEFAULT_SPAWN_IDLE_TIMEOUT_MIN = 45;

function spawnWithStdin(cmd: string, args: string[], prompt: string, label: string, idleTimeoutMin?: number): Promise<string> {
  const idleLimit = idleTimeoutMin ?? DEFAULT_SPAWN_IDLE_TIMEOUT_MIN;
  return new Promise((resolve) => {
    console.log(`  [${label}] Spawning with ${prompt.length} char prompt via stdin (idle timeout: ${idleLimit} min)...`);

    const proc = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChildProcesses.add(proc);

    let stdout = "";
    let stderr = "";
    let lastOutputTime = Date.now();
    const startTime = Date.now();

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      lastOutputTime = Date.now();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      lastOutputTime = Date.now();
    });

    // Write prompt to stdin then close it
    proc.stdin.write(prompt);
    proc.stdin.end();

    // Health check every 5 minutes — kill if no output for idleLimit minutes
    const healthCheck = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 60_000);
      const silentFor = Math.round((Date.now() - lastOutputTime) / 60_000);

      if (silentFor >= idleLimit) {
        console.error(`  [${label}] No output for ${idleLimit} min (running for ${elapsed} min) — killing process`);
        clearInterval(healthCheck);
        proc.kill("SIGTERM");
      } else {
        console.log(`  [${label}] Health check: running for ${elapsed} min, last output ${silentFor} min ago, stdout ${stdout.length} chars`);
      }
    }, 5 * 60_000); // Every 5 minutes

    proc.on("close", (code) => {
      clearInterval(healthCheck);
      activeChildProcesses.delete(proc);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [${label}] Process exited with code ${code} after ${elapsed}s`);
      if (code !== 0 && !stdout.trim()) {
        console.error(`  [${label}] Exit code ${code}: ${stderr.slice(0, 200)}`);
        resolve(`Error (exit ${code}): ${stderr.slice(0, 500)}`);
        return;
      }
      resolve(stdout.trim() || stderr.trim() || "No output");
    });

    proc.on("error", (err) => {
      clearInterval(healthCheck);
      activeChildProcesses.delete(proc);
      console.error(`  [${label}] Spawn error: ${err.message}`);
      resolve(`Error: ${err.message}`);
    });
  });
}

async function spawnClaude(prompt: string, model?: string, idleTimeoutMin?: number): Promise<string> {
  const args = [
    "@anthropic-ai/claude-code",
    "-p", "-",   // read prompt from stdin
    "--output-format", "text",
    "--dangerously-skip-permissions",
  ];
  if (model) args.push("--model", model);
  return spawnWithStdin("npx", args, prompt, "Claude", idleTimeoutMin);
}

async function spawnCodex(prompt: string, agent?: AgentConfig, idleTimeoutMin?: number): Promise<string> {
  const options = {
    reasoningEffort: agent?.reasoningEffort as import("@/lib/agent-command-config").CodexReasoningEffort | undefined,
    sandbox: agent?.sandbox as import("@/lib/agent-command-config").CodexSandboxMode | undefined,
    model: agent?.model,
    allowedDirectories: agent?.allowedDirectories,
  };
  // Use codex from PATH — users install via: npm install -g @openai/codex
  const codexBin = process.env.CODEX_BIN || "codex";
  return spawnWithStdin(codexBin, buildCodexExecArgs(process.env, options), prompt, "Codex", idleTimeoutMin);
}

async function spawnAgent(agent: AgentConfig, prompt: string, idleTimeoutMin?: number): Promise<string> {
  const provider = agent.provider;

  // Check provider health — warn but still attempt
  if (!isProviderHealthy(provider)) {
    console.log(`[Provider] Warning: ${provider} may be unhealthy, attempting anyway...`);
  }

  let result: string;
  if (provider === "claude") {
    result = await spawnClaude(prompt, agent.model, idleTimeoutMin);
  } else if (provider === "codex") {
    result = await spawnCodex(prompt, agent, idleTimeoutMin);
  } else {
    return `Unknown provider: ${provider}`;
  }

  // Track provider health based on result
  if (/rate.?limit|429|too many requests|Error \(exit/i.test(result) && result.length < 500) {
    markProviderError(provider, result);
  } else {
    markProviderSuccess(provider);
  }

  return result;
}

// --- Main Loop ---

async function logActivity(agentId: string, action: string, detail: string) {
  await api("/activity", "POST", { agent: agentId, action, detail });
}

async function processTask(agent: AgentConfig, task: SharedTask) {
  const agentId = agent.id;

  console.log(`\n[${agent.name}] Picking up task: "${task.title}"`);

  // Mark agent as working + track current task
  busyAgents.add(agentId);
  const taskStartedAt = new Date().toISOString();
  await api("/agents", "PATCH", {
    id: agentId,
    status: "working",
    lastActive: taskStartedAt,
    currentTaskId: task.id,
    currentTaskTitle: task.title,
    taskStartedAt,
  });
  await api("/tasks", "PATCH", { id: task.id, status: "in_progress", assignee: agentId });
  await logActivity(agentId, "started_task", `Started: ${task.title}`);
  const startTime = Date.now();

  // Get messages for this agent
  const messages = await api<AgentMessage[]>(`/messages?for=${agentId}`);

  // Mark messages as read
  for (const msg of messages) {
    await api("/messages", "PATCH", { id: msg.id, read: true });
  }

  // Read agent memory and role instructions
  const agentMemory = await readAgentMemory(agent.file);
  const roleInstructions = await readRoleInstructions(agent.role);

  // Retrieve relevant memories from Smart Memory
  let smartMemoryContext = "";
  if (smartMemoryAvailable) {
    console.log(`  [${agent.name}] Retrieving memories from Smart Memory...`);
    smartMemoryContext = await retrieveMemories(agentId, task.description);
    if (smartMemoryContext) {
      console.log(`  [${agent.name}] Got ${smartMemoryContext.split("\n").length} relevant memories`);
    }
  }

  // Build team context: what other agents are working on right now
  const allAgents = await api<AgentConfig[]>("/agents");
  const teammates = allAgents
    .filter((a) => a.id !== agentId && a.currentTaskId)
    .map((a) => `- ${a.name} (${a.role}) is working on "${a.currentTaskTitle}"`)
    .join("\n");
  const teamContext = teammates || "No other agents are currently working.";

  // Fetch spawn idle timeout from settings
  const settings = await api<{ spawnIdleTimeout?: number }>("/settings");
  const idleTimeoutMin = settings.spawnIdleTimeout ?? DEFAULT_SPAWN_IDLE_TIMEOUT_MIN;

  // Build prompt and spawn
  const prompt = await buildPrompt(task, messages, agentMemory, roleInstructions, smartMemoryContext, teamContext);
  const result = await spawnAgent(agent, prompt, idleTimeoutMin);

  console.log(`[${agent.name}] Completed task: "${task.title}"`);
  console.log(`  Result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);

  // Check if agent process failed (timeout, crash, error exit)
  const isProcessError = /^Error \(exit \d+\):|^Error: Process timed out|^Error:/i.test(result.trim()) && result.trim().length < 500;
  if (isProcessError) {
    console.log(`[${agent.name}] Agent process failed for "${task.title}": ${result.slice(0, 200)}`);
    await api("/tasks", "PATCH", {
      id: task.id,
      status: "todo",
      assignee: "unassigned",
      blocked: true,
      blockedReason: `Agent process failed: ${result.slice(0, 300)}`,
      result: result.slice(0, 2000),
    });
    const blockerKey = `task-error:${task.id}`;
    if (!notifiedBlockers.has(blockerKey)) {
      notifiedBlockers.add(blockerKey);
      await api("/channel-messages", "POST", {
        channelId: "blockers",
        from: "orchestrator",
        content: `Task "${task.title}" failed — agent process error: ${result.slice(0, 200)}. Task moved back to backlog as blocked.`,
      });
    }
    await logActivity(agentId, "task_error", `Process error on "${task.title}": ${result.slice(0, 150)}`);

    // Clean up agent state
    busyAgents.delete(agentId);
    await api("/agents", "PATCH", { id: agentId, status: "idle", lastActive: new Date().toISOString(), currentTaskId: null, currentTaskTitle: null, taskStartedAt: null });
    return;
  }

  // Check if agent requested a specific status
  const requestedDone = result.includes("STATUS: done");
  const blockedMatch = result.match(/STATUS:\s*blocked\s*REASON:\s*(.+)/i);

  if (blockedMatch) {
    // Task is blocked — keep current column, mark as blocked
    const reason = blockedMatch[1].trim();
    console.log(`[${agent.name}] BLOCKED: ${reason}`);

    await api("/tasks", "PATCH", {
      id: task.id,
      status: task.status === "todo" ? "todo" : "in_progress",
      blocked: true,
      blockedReason: reason,
      result: result.slice(0, 2000),
    });

    // Post to blockers channel — tag human if their input is likely needed (deduplicated)
    const blockerKey = `task-blocked:${task.id}`;
    if (!notifiedBlockers.has(blockerKey)) {
      notifiedBlockers.add(blockerKey);
      const needsHuman = /human|input|decision|approval|permission|clarif|confirm|access|credential|secret|key|token/i.test(reason);
      const channelMsg = needsHuman
        ? `@human Blocked on "${task.title}" — your input is needed: ${reason}`
        : `Blocked on "${task.title}": ${reason}`;

      await api("/channel-messages", "POST", {
        channelId: "blockers",
        from: agentId,
        content: channelMsg,
        taskId: task.id,
      });

      if (needsHuman) {
        await api("/channel-messages", "POST", {
          channelId: "general",
          from: agentId,
          content: `@human I'm blocked on "${task.title}" and need your input. Please check #blockers for details.`,
          taskId: task.id,
        });
      }
    }

    await logActivity(agentId, "blocked_task", `Blocked: ${task.title} — ${reason}`);
  } else {
    const finalStatus = requestedDone ? "done" : "review";

    // Update task with result
    await api("/tasks", "PATCH", {
      id: task.id,
      status: finalStatus,
      blocked: false,
      blockedReason: undefined,
      result: result.slice(0, 2000),
    });

    // Ingest task interaction into Smart Memory
    if (smartMemoryAvailable) {
      const sessionId = `${agentId}-${task.id}`;
      await ingestToSmartMemory(agentId, sessionId, task.title, task.description, result.slice(0, 3000));
      console.log(`  [${agent.name}] Ingested to Smart Memory (session: ${sessionId})`);
    }

    // Auto-create a doc entry for the completed task
    await api("/docs", "POST", {
      title: `${task.title} — Result`,
      content: result.slice(0, 5000),
      project: task.project || undefined,
      author: agentId,
      taskId: task.id,
    });
    console.log(`  [${agent.name}] Created doc entry for task result`);

    await logActivity(agentId, "completed_task", `Completed: ${task.title} — ${result.slice(0, 200)}`);

    // Check if completing this task unblocks downstream tasks
    if (finalStatus === "done") {
      await checkAndUnblockDependents(task.id, task.title);
    }

    // Write learning to agent memory file
    await writeAgentLearning(agent.file, task.title, result);

    // Check for SPLIT protocol — agent wants to break task into sub-tasks
    const splitMatch = result.match(/SPLIT:\s*(\[[\s\S]*?\])/);
    if (splitMatch) {
      try {
        const subTasks = JSON.parse(splitMatch[1]) as { title: string; description: string; priority?: string; dependsOn?: string[] }[];
        const createdIds: Record<string, string> = {};
        for (const sub of subTasks) {
          const created = await api<{ id: string }>("/tasks", "POST", {
            title: sub.title,
            description: sub.description || "",
            assignee: "unassigned",
            project: task.project,
            priority: sub.priority || task.priority,
            createdBy: agentId,
          });
          createdIds[sub.title] = created.id;
        }
        // Resolve title-based dependencies to actual IDs
        for (const sub of subTasks) {
          if (sub.dependsOn && sub.dependsOn.length > 0) {
            const depIds = sub.dependsOn
              .map((title) => createdIds[title])
              .filter(Boolean);
            if (depIds.length > 0) {
              // Check for circular dependencies before setting
              const allTasks = await api<SharedTask[]>("/tasks");
              const hasCycle = detectCircularDependency(allTasks, createdIds[sub.title], depIds);
              if (hasCycle) {
                console.warn(`[${agent.name}] Skipping circular dependency for "${sub.title}"`);
              } else {
                await api("/tasks", "PATCH", { id: createdIds[sub.title], dependsOn: depIds });
              }
            }
          }
        }
        console.log(`[${agent.name}] Split task into ${subTasks.length} sub-tasks`);
        await logActivity(agentId, "split_task", `Split "${task.title}" into ${subTasks.length} sub-tasks`);
      } catch (err) {
        console.error(`[${agent.name}] Failed to parse SPLIT:`, err);
      }
    }
  }

  // Post metrics
  const durationMs = Date.now() - startTime;
  await api("/metrics", "POST", {
    agentId,
    taskId: task.id,
    promptTokens: 0,  // TODO: parse from JSON output when available
    completionTokens: 0,
    totalTokens: 0,
    durationMs,
    provider: agent.provider,
    model: agent.model || "",
  });

  // Mark agent as idle + clear current task
  busyAgents.delete(agentId);
  await api("/agents", "PATCH", {
    id: agentId,
    status: "idle",
    lastActive: new Date().toISOString(),
    currentTaskId: null,
    currentTaskTitle: null,
    taskStartedAt: null,
  });
}

async function processReviewTask(agent: AgentConfig, task: SharedTask) {
  const agentId = agent.id;
  console.log(`\n[${agent.name}] Reviewing task: "${task.title}"...`);

  busyAgents.add(agentId);
  const startTime = Date.now();

  await api("/agents", "PATCH", {
    id: agentId,
    status: "working",
    lastActive: new Date().toISOString(),
    currentTaskId: task.id,
    currentTaskTitle: `Review: ${task.title}`,
    taskStartedAt: new Date().toISOString(),
  });

  // Gather context
  const agentMemory = await readAgentMemory(agent.file);
  const roleInstructions = await readRoleInstructions(agent.role);

  // Build review prompt with the task result
  const prompt = [
    roleInstructions ? `=== ROLE INSTRUCTIONS ===\n${roleInstructions}` : "",
    agentMemory ? `=== AGENT IDENTITY ===\n${agentMemory}` : "",
    `=== TASK UNDER REVIEW ===`,
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    `Description: ${task.description}`,
    `Completed by: ${task.assignee}`,
    task.result ? `\n=== WORK RESULT ===\n${task.result}` : "\n(No result provided)",
    `\n=== YOUR JOB ===`,
    `Review the work done on this task. Check if:`,
    `1. The work actually addresses what the task description asked for`,
    `2. The approach is reasonable and complete`,
    `3. There are no obvious issues or gaps`,
    ``,
    `Then respond with ONE of:`,
    `- "REVIEW: approved" — if the work looks good and the task should be marked done`,
    `- "REVIEW: rejected REASON: <explain what's wrong or missing>" — if the work needs to be redone`,
    ``,
    `Include a brief summary of your review before the verdict.`,
  ].filter(Boolean).join("\n");

  const result = await spawnAgent(agent, prompt);

  console.log(`[${agent.name}] Review result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);

  const approved = /REVIEW:\s*approved/i.test(result);
  const rejectedMatch = result.match(/REVIEW:\s*rejected\s*REASON:\s*(.+)/i);

  if (approved) {
    await api("/tasks", "PATCH", { id: task.id, status: "done", result: `${task.result || ""}\n\n--- QA Review (${agent.name}) ---\n${result.slice(0, 1000)}` });
    console.log(`[${agent.name}] APPROVED: "${task.title}" → done`);
    await logActivity(agentId, "approved_task", `Approved: ${task.title}`);
    await checkAndUnblockDependents(task.id, task.title);

    // Notify in general
    await api("/channel-messages", "POST", {
      channelId: "general",
      from: agentId,
      content: `✓ Reviewed and approved: "${task.title}"`,
    });
  } else if (rejectedMatch) {
    const reason = rejectedMatch[1].trim();
    await api("/tasks", "PATCH", {
      id: task.id,
      status: "todo",
      assignee: "unassigned",
      result: `${task.result || ""}\n\n--- QA Review (${agent.name}) ---\nREJECTED: ${reason}`,
    });
    console.log(`[${agent.name}] REJECTED: "${task.title}" — ${reason}`);
    await logActivity(agentId, "rejected_task", `Rejected: ${task.title} — ${reason}`);

    // Notify in general so the team knows
    await api("/channel-messages", "POST", {
      channelId: "general",
      from: agentId,
      content: `✗ Reviewed and sent back: "${task.title}" — ${reason}`,
    });
  } else {
    // Couldn't parse verdict — leave in review for another attempt next tick
    console.log(`[${agent.name}] Review verdict unclear for "${task.title}" — will retry`);
    await api("/channel-messages", "POST", {
      channelId: "general",
      from: agentId,
      content: `Review of "${task.title}" was inconclusive — will retry on next cycle.`,
    });
  }

  // Post metrics
  const durationMs = Date.now() - startTime;
  await api("/metrics", "POST", {
    agentId,
    taskId: task.id,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs,
    provider: agent.provider,
    model: agent.model || "",
  });

  // Mark agent idle
  busyAgents.delete(agentId);
  await api("/agents", "PATCH", {
    id: agentId,
    status: "idle",
    lastActive: new Date().toISOString(),
    currentTaskId: null,
    currentTaskTitle: null,
    taskStartedAt: null,
  });
}

async function processMessage(agent: AgentConfig, messages: AgentMessage[]) {
  const agentId = agent.id;
  const msgText = messages.map((m) => `[${m.from}]: ${m.content}`).join("\n");

  console.log(`\n[${agent.name}] Responding to ${messages.length} message(s)...`);

  busyAgents.add(agentId);
  await api("/agents", "PATCH", { id: agentId, status: "working", lastActive: new Date().toISOString() });

  // Mark messages as read
  for (const msg of messages) {
    await api("/messages", "PATCH", { id: msg.id, read: true });
  }

  // Read agent context
  const agentMemory = await readAgentMemory(agent.file);
  const roleInstructions = await readRoleInstructions(agent.role);

  // Retrieve relevant memories based on message content
  let smartMemoryContext = "";
  if (smartMemoryAvailable) {
    const queryText = messages.map((m) => m.content).join(" ");
    smartMemoryContext = await retrieveMemories(agentId, queryText);
  }

  const parts: string[] = [];
  if (roleInstructions) parts.push(`=== ROLE INSTRUCTIONS ===\n${roleInstructions}`);
  if (agentMemory) parts.push(`=== AGENT MEMORY ===\n${agentMemory}`);
  if (smartMemoryContext) parts.push(`=== RELEVANT MEMORIES ===\n${smartMemoryContext}`);
  parts.push(`=== MESSAGES ===\n${msgText}`);
  parts.push(`\nRespond to these messages concisely. If someone asked a question, answer it. If given instructions, acknowledge them.`);

  const prompt = parts.join("\n\n");
  const result = await spawnAgent(agent, prompt);

  console.log(`[${agent.name}] Response: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);

  // Post the response as a message back
  const sender = messages[0]?.from || "human";
  await api("/messages", "POST", {
    from: agentId,
    to: sender,
    content: result.slice(0, 8000),
  });

  // Ingest DM interaction into Smart Memory
  if (smartMemoryAvailable) {
    const sessionId = `${agentId}-dm-${Date.now()}`;
    await ingestToSmartMemory(agentId, sessionId, `DM with ${sender}`, msgText, result.slice(0, 3000));
  }

  await logActivity(agentId, "replied", `Replied to ${sender}: ${result.slice(0, 150)}`);

  busyAgents.delete(agentId);
  await api("/agents", "PATCH", { id: agentId, status: "idle", lastActive: new Date().toISOString() });
}

/**
 * Resolve an agent reference to a valid agent ID.
 * Handles: exact ID, name (case-insensitive), provider name (picks first idle agent of that provider),
 * role name (picks first idle agent with that role), or "unassigned" to clear.
 */
async function resolveAgentId(ref: string): Promise<string> {
  if (!ref || ref === "unassigned") return "unassigned";
  const agents = await api<AgentConfig[]>("/agents");
  const lower = ref.toLowerCase();
  // Exact ID match
  if (agents.find((a) => a.id === ref)) return ref;
  // Name match (case-insensitive)
  const byName = agents.find((a) => a.name.toLowerCase() === lower);
  if (byName) return byName.id;
  // Provider match (e.g. "codex" or "claude") — pick first idle engineer, fallback to first available
  // This is a fallback — agents SHOULD use agent IDs, not provider names
  const byProvider = agents.filter((a) => a.provider.toLowerCase() === lower);
  if (byProvider.length > 0) {
    const idleEngineer = byProvider.find((a) => (a.status === "idle" || a.status === "active") && a.role !== "comms");
    const idle = idleEngineer || byProvider.find((a) => a.status === "idle" || a.status === "active");
    const resolved = (idle || byProvider[0]);
    console.log(`[resolveAgentId] WARNING: "${ref}" is a provider name, not an agent ID. Resolved to "${resolved.name}" (${resolved.id}). Agents should use exact IDs.`);
    return resolved.id;
  }
  // Role match (e.g. "engineer", "qa") — pick first idle
  const byRole = agents.filter((a) => a.role.toLowerCase() === lower);
  if (byRole.length > 0) {
    const idle = byRole.find((a) => a.status === "idle" || a.status === "active");
    const resolved = (idle || byRole[0]);
    console.log(`[resolveAgentId] Resolved role "${ref}" to "${resolved.name}" (${resolved.id})`);
    return resolved.id;
  }
  // Fallback: return as-is (will be treated as unknown by assignment loop)
  console.log(`[resolveAgentId] Could not resolve "${ref}" to a known agent`);
  return ref;
}

async function executeAgentActions(agentId: string, agentName: string, result: string, channelId: string) {
  // Parse create_project actions
  const projectMatches = result.matchAll(/ACTION:\s*create_project\s*(\{[^}]*\})/g);
  for (const match of projectMatches) {
    try {
      const data = JSON.parse(match[1]) as { name: string; description: string };
      const project = await api<{ id: string; name: string }>("/projects", "POST", {
        name: data.name,
        description: data.description,
        color: "#8b5cf6",
        status: "draft",
      });
      console.log(`[${agentName}] Created project: "${data.name}" (${project.id})`);
      await api("/channel-messages", "POST", {
        channelId,
        from: "orchestrator",
        content: `Project "${data.name}" created (status: draft). Use "generate backlog" or activate it when ready.`,
      });
      await logActivity(agentId, "created_project", `Created project: ${data.name}`);
    } catch (err) {
      console.error(`[${agentName}] Failed to create project:`, err);
    }
  }

  // Parse create_task actions
  const taskMatches = result.matchAll(/ACTION:\s*create_task\s*(\{[^}]*\})/g);
  for (const match of taskMatches) {
    try {
      const data = JSON.parse(match[1]) as { title: string; description?: string; priority?: string; project?: string; preferredRole?: string };
      const task = await api<{ id: string }>("/tasks", "POST", {
        title: data.title,
        description: data.description || "",
        assignee: "unassigned",
        priority: data.priority || "P1",
        project: data.project || undefined,
        preferredRole: data.preferredRole || undefined,
        createdBy: agentId,
      });
      console.log(`[${agentName}] Created task: "${data.title}" (${task.id})`);
      await logActivity(agentId, "created_task", `Created task: ${data.title}`);
    } catch (err) {
      console.error(`[${agentName}] Failed to create task:`, err);
    }
  }

  // Parse generate_backlog actions
  const backlogMatches = result.matchAll(/ACTION:\s*generate_backlog\s*(\{[^}]*\})/g);
  for (const match of backlogMatches) {
    try {
      const data = JSON.parse(match[1]) as { projectId: string };
      // Trigger the existing backlog generation endpoint
      await api("/projects/generate-tasks", "POST", { projectId: data.projectId });
      console.log(`[${agentName}] Triggered backlog generation for project ${data.projectId}`);
      await api("/channel-messages", "POST", {
        channelId,
        from: "orchestrator",
        content: `Generating task backlog for the project. Tasks will appear on the board shortly.`,
      });
    } catch (err) {
      console.error(`[${agentName}] Failed to generate backlog:`, err);
    }
  }

  // Parse unblock_task actions
  const unblockMatches = result.matchAll(/ACTION:\s*unblock_task\s*(\{[^}]*\})/g);
  for (const match of unblockMatches) {
    try {
      const data = JSON.parse(match[1]) as { taskId: string; assignee?: string };
      const tasks = await api<SharedTask[]>("/tasks");
      const task = tasks.find((t) => t.id === data.taskId);
      if (task?.blocked) {
        const patch: Record<string, unknown> = { id: data.taskId, blocked: false, blockedReason: undefined };
        // If an assignee was specified, resolve to a real agent ID and reassign
        if (data.assignee) {
          patch.assignee = await resolveAgentId(data.assignee);
          patch.status = "todo"; // Reset to todo so the new assignee picks it up cleanly
        }
        await api("/tasks", "PATCH", patch);
        // Clear blocker dedup so it can notify again if re-blocked
        notifiedBlockers.delete(`task-blocked:${data.taskId}`);
        notifiedBlockers.delete(`task-error:${data.taskId}`);
        const reassignMsg = data.assignee ? ` and reassigned to ${data.assignee}` : "";
        await api("/channel-messages", "POST", {
          channelId,
          from: "orchestrator",
          content: `"${task.title}" has been unblocked${reassignMsg} and is ready for assignment.`,
        });
        console.log(`[${agentName}] Unblocked task: "${task.title}"${reassignMsg}`);
        await logActivity(agentId, "unblocked_task", `Unblocked task: ${task.title}${reassignMsg}`);
      } else {
        console.log(`[${agentName}] Tried to unblock task ${data.taskId} but it's not blocked`);
      }
    } catch (err) {
      console.error(`[${agentName}] Failed to unblock task:`, err);
    }
  }

  // Parse reassign_task actions
  const reassignMatches = result.matchAll(/ACTION:\s*reassign_task\s*(\{[^}]*\})/g);
  for (const match of reassignMatches) {
    try {
      const data = JSON.parse(match[1]) as { taskId: string; assignee: string };
      const resolvedAssignee = await resolveAgentId(data.assignee);
      const tasks = await api<SharedTask[]>("/tasks");
      const task = tasks.find((t) => t.id === data.taskId);
      if (task) {
        await api("/tasks", "PATCH", { id: data.taskId, assignee: resolvedAssignee, status: "todo" });
        await api("/channel-messages", "POST", {
          channelId,
          from: "orchestrator",
          content: `"${task.title}" has been reassigned to ${data.assignee}.`,
        });
        console.log(`[${agentName}] Reassigned task "${task.title}" to ${data.assignee}`);
        await logActivity(agentId, "reassigned_task", `Reassigned "${task.title}" to ${data.assignee}`);
      } else {
        console.log(`[${agentName}] Tried to reassign task ${data.taskId} but it wasn't found`);
      }
    } catch (err) {
      console.error(`[${agentName}] Failed to reassign task:`, err);
    }
  }

  // Parse resume_deliberation actions
  const resumeMatches = result.matchAll(/ACTION:\s*resume_deliberation\s*(\{[^}]*\})/g);
  for (const match of resumeMatches) {
    try {
      const data = JSON.parse(match[1]) as { projectId: string };
      const projects = await api<ProjectConfig[]>("/projects");
      const project = projects.find((p) => p.id === data.projectId);
      if (project?.phaseMetadata?.waitingForHuman) {
        const meta = { ...project.phaseMetadata, waitingForHuman: false, waitingReason: undefined, contributedAgents: [], currentRound: (project.phaseMetadata.currentRound || 1) + 1, phaseStartedAt: new Date().toISOString() };
        await api("/projects", "PATCH", { id: data.projectId, phaseMetadata: meta });
        await api("/channel-messages", "POST", {
          channelId,
          from: "orchestrator",
          content: `Deliberation resumed for "${project.name}". Starting round ${meta.currentRound}.`,
        });
        console.log(`[${agentName}] Resumed deliberation for "${project.name}"`);
        await logActivity(agentId, "resumed_deliberation", `Resumed deliberation for ${project.name}`);
      } else {
        console.log(`[${agentName}] Tried to resume deliberation for ${data.projectId} but it's not waiting for human`);
      }
    } catch (err) {
      console.error(`[${agentName}] Failed to resume deliberation:`, err);
    }
  }

  // Parse complete_phase actions
  const completePhaseMatches = result.matchAll(/ACTION:\s*complete_phase\s*(\{[^}]*\})/g);
  for (const match of completePhaseMatches) {
    try {
      const data = JSON.parse(match[1]) as { projectId: string };
      const projects = await api<ProjectConfig[]>("/projects");
      const project = projects.find((p) => p.id === data.projectId);
      if (project) {
        if (project.phase === "retrospective") {
          // Complete the retro — mark project completed
          await api("/projects", "PATCH", { id: data.projectId, phase: "completed", status: "completed", phaseMetadata: { ...project.phaseMetadata, waitingForHuman: false } });
          await api("/channel-messages", "POST", {
            channelId,
            from: "orchestrator",
            content: `Retrospective complete for "${project.name}". Project closed.`,
          });
          console.log(`[${agentName}] Completed retrospective for "${project.name}"`);
          await logActivity(agentId, "completed_phase", `Completed retrospective for ${project.name}`);
        } else if (project.phase === "discovery") {
          // Move discovery → execution
          const meta = { ...project.phaseMetadata, waitingForHuman: false };
          await api("/projects", "PATCH", { id: data.projectId, phase: "execution", phaseMetadata: meta });
          await api("/channel-messages", "POST", {
            channelId,
            from: "orchestrator",
            content: `Discovery complete for "${project.name}". Moving to execution.`,
          });
          console.log(`[${agentName}] Moved "${project.name}" from discovery to execution`);
          await logActivity(agentId, "completed_phase", `Moved ${project.name} to execution`);
        } else {
          console.log(`[${agentName}] Tried to complete phase for ${data.projectId} but phase is "${project.phase}"`);
        }
      }
    } catch (err) {
      console.error(`[${agentName}] Failed to complete phase:`, err);
    }
  }
}

async function processChannelMessage(agent: AgentConfig, msg: ChannelMessage) {
  const agentId = agent.id;

  console.log(`\n[${agent.name}] Responding in #${msg.channelId} to: "${msg.content.slice(0, 80)}..."`);

  busyAgents.add(agentId);
  processedChannelMessages.add(msg.id);
  await api("/agents", "PATCH", { id: agentId, status: "working", lastActive: new Date().toISOString(), currentChannelId: msg.channelId });

  const agentMemory = await readAgentMemory(agent.file);
  const roleInstructions = await readRoleInstructions(agent.role);

  // Retrieve relevant memories for channel context
  let smartMemoryContext = "";
  if (smartMemoryAvailable) {
    smartMemoryContext = await retrieveMemories(agentId, msg.content);
  }

  // Fetch mission control context so the agent can reason about tasks, projects, and docs
  const [tasks, projects, docs] = await Promise.all([
    api<SharedTask[]>("/tasks"),
    api<ProjectConfig[]>("/projects"),
    api<DocEntry[]>("/docs"),
  ]);

  // Fetch agents for context
  const agentList = await api<AgentConfig[]>("/agents");
  const agentContext = agentList.map((a) => `${a.id} (${a.name}, ${a.provider}, role: ${a.role})`).join(", ");

  const taskSummary = tasks.map((t) =>
    `- [${t.id}] [${t.status}${t.blocked ? "/BLOCKED" : ""}] "${t.title}" (${t.priority}, assignee: ${t.assignee})${t.blockedReason ? ` — blocked: ${t.blockedReason}` : ""}`
  ).join("\n");

  const projectSummary = projects.map((p) => {
    const status = p.status || "draft";
    const phase = p.phase ? ` (phase: ${p.phase})` : "";
    const waiting = p.phaseMetadata?.waitingForHuman ? " [WAITING FOR HUMAN INPUT]" : "";
    return `- [${p.id}] "${p.name}" — ${status}${phase}${waiting}`;
  }).join("\n");

  const docSummary = docs.slice(0, 10).map((d) =>
    `- "${d.title}" by ${d.author}${d.content ? `: ${d.content.slice(0, 150)}...` : ""}`
  ).join("\n");

  // Get recent channel history for conversation context
  const recentMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${msg.channelId}`);
  const history = recentMsgs.slice(-10).map((m) => `[${m.from}]: ${m.content}`).join("\n");

  const parts: string[] = [];
  if (roleInstructions) parts.push(`=== ROLE INSTRUCTIONS ===\n${roleInstructions}`);
  if (agentMemory) parts.push(`=== AGENT MEMORY ===\n${agentMemory}`);
  if (smartMemoryContext) parts.push(`=== RELEVANT MEMORIES ===\n${smartMemoryContext}`);
  if (taskSummary) parts.push(`=== CURRENT TASKS ===\n${taskSummary}`);
  parts.push(`=== AVAILABLE AGENTS ===
When assigning or reassigning tasks, ALWAYS use agent IDs (not provider names like "codex" or "claude" — multiple agents can share a provider).
${agentContext}`);
  if (projectSummary) parts.push(`=== PROJECTS ===\n${projectSummary}`);
  if (docSummary) parts.push(`=== RECENT DOCS ===\n${docSummary}`);
  if (history) parts.push(`=== CHANNEL HISTORY (#${msg.channelId}) ===\n${history}`);
  parts.push(`=== NEW MESSAGE (in #${msg.channelId}) ===\n[${msg.from}]: ${msg.content}`);

  // Add blocker-aware instructions — applies to ALL channels, not just #blockers
  const blockedTasks = tasks.filter((t) => t.blocked);
  if (blockedTasks.length > 0) {
    const blockedList = blockedTasks.map((t) =>
      `- [${t.id}] "${t.title}" — blocked: ${t.blockedReason || "unknown"}`
    ).join("\n");
    parts.push(`=== BLOCKED TASKS ===
These tasks are currently blocked:
${blockedList}

IMPORTANT: If the human provides information that resolves a blocker (e.g. a file path, access grant, clarification), you MUST immediately use ACTION: unblock_task {"taskId": "<id>"} to unblock it. Do NOT just acknowledge — take the action.
If the blocker requires a different agent, use: ACTION: unblock_task {"taskId": "<id>", "assignee": "agent-id"}
If you need more info, ask — but do NOT leave a task blocked when the human has clearly provided what was needed.`);
  }

  // Add stalled project context — tell agent which projects need resume_deliberation
  const stalledProjects = projects.filter((p) => p.phaseMetadata?.waitingForHuman && (p.status === "active" || p.status === "paused"));
  if (stalledProjects.length > 0) {
    const stalledList = stalledProjects.map((p) =>
      `- [${p.id}] "${p.name}" — stalled in ${p.phase}${p.phaseMetadata?.waitingReason ? ` (reason: ${p.phaseMetadata.waitingReason.slice(0, 150)})` : ""}`
    ).join("\n");
    parts.push(`=== STALLED PROJECTS ===
These projects are paused and waiting for human input. If the human says "proceed", "go ahead", "continue", "resume", or otherwise indicates they want to move forward, you MUST use ACTION: resume_deliberation with the project ID to unstick it.
${stalledList}`);
  }

  parts.push(`\nRespond to this message concisely. You have full context of the task board, projects, and docs above. If the human asks about a specific task, project, or doc, reference the details.

=== ACTIONS ===
You can take actions by including action blocks in your response. The orchestrator will execute them automatically.

To create a project:
ACTION: create_project {"name": "Project Name", "description": "Full description and requirements"}

To create a task (optionally in a project):
ACTION: create_task {"title": "Task title", "description": "What needs to be done", "priority": "P0|P1|P2", "project": "project-id-or-omit", "preferredRole": "engineer|qa|architect|researcher|ops"}

To generate a task backlog for a project (the orchestrator will auto-decompose):
ACTION: generate_backlog {"projectId": "project-id"}

To unblock a task (ONLY when the human has provided enough information to resolve the blocker):
ACTION: unblock_task {"taskId": "task-id"}

To unblock AND reassign a task to a different agent in one step:
ACTION: unblock_task {"taskId": "task-id", "assignee": "agent-id"}

To reassign a task to a different agent (without unblocking — use when the task is not blocked but should be worked on by someone else):
ACTION: reassign_task {"taskId": "task-id", "assignee": "agent-id"}

To resume a stalled deliberation (discovery or retrospective) after the human has provided input or said to proceed:
ACTION: resume_deliberation {"projectId": "project-id"}

To complete a project's current phase and move it forward (e.g. close a retrospective when the human approves):
ACTION: complete_phase {"projectId": "project-id"}

You can include multiple actions. Always explain to the human what you're doing alongside the actions.

CRITICAL: When you decide to take an action, you MUST include the ACTION: block in your response. Do NOT just say "I'll unblock it" or "I'm resuming" — the orchestrator can only execute actions it can parse from your response. No ACTION: block = no action taken.`);

  const prompt = parts.join("\n\n");
  const result = await spawnAgent(agent, prompt);

  console.log(`[${agent.name}] Channel response: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);

  // Strip action blocks from the visible message
  const visibleResult = result.replace(/ACTION:\s*(create_project|create_task|generate_backlog|unblock_task|reassign_task|resume_deliberation|complete_phase)\s*\{[^}]*\}/g, "").trim();

  // Post response back to the same channel (without raw action blocks)
  await api("/channel-messages", "POST", {
    channelId: msg.channelId,
    from: agentId,
    content: visibleResult.slice(0, 8000),
  });

  // Execute any actions the agent included in the response
  await executeAgentActions(agentId, agent.name, result, msg.channelId);

  // Ingest channel interaction into Smart Memory
  if (smartMemoryAvailable) {
    const sessionId = `${agentId}-channel-${msg.channelId}-${Date.now()}`;
    await ingestToSmartMemory(agentId, sessionId, `Channel #${msg.channelId}`, msg.content, result.slice(0, 3000));
  }

  await logActivity(agentId, "replied", `Replied in #${msg.channelId}: ${result.slice(0, 150)}`);

  busyAgents.delete(agentId);
  await api("/agents", "PATCH", { id: agentId, status: "idle", lastActive: new Date().toISOString(), currentChannelId: null });
}

// --- Loop Task Processing ---

async function processLoopTask(agent: AgentConfig, task: SharedTask & { loopConfig: LoopConfig }) {
  const agentId = agent.id;
  const loop = task.loopConfig;

  console.log(`\n[${agent.name}] Starting loop task: "${task.title}" (iteration ${loop.currentIteration + 1}/${loop.maxIterations})`);

  busyAgents.add(agentId);
  const taskStartedAt = new Date().toISOString();
  await api("/agents", "PATCH", {
    id: agentId,
    status: "working",
    lastActive: taskStartedAt,
    currentTaskId: task.id,
    currentTaskTitle: `${task.title} (iter ${loop.currentIteration + 1})`,
    taskStartedAt,
  });
  await api("/tasks", "PATCH", { id: task.id, status: "in_progress" });

  const startTime = Date.now();
  const agentMemory = await readAgentMemory(agent.file);
  const roleInstructions = await readRoleInstructions(agent.role);

  // Retrieve relevant memories for loop task context
  let smartMemoryContext = "";
  if (smartMemoryAvailable) {
    smartMemoryContext = await retrieveMemories(agentId, `${task.title}: ${loop.objective}`);
  }

  // Build iteration history summary
  const historyText = loop.iterationHistory.length > 0
    ? loop.iterationHistory.map((h) =>
        `  Iteration ${h.iteration}: ${h.metricValue ? `metric=${h.metricValue}` : "no metric"} — ${h.result.slice(0, 200)}`
      ).join("\n")
    : "  No previous iterations.";

  const prompt = [
    roleInstructions ? `=== ROLE INSTRUCTIONS ===\n${roleInstructions}` : "",
    agentMemory ? `=== AGENT IDENTITY ===\n${agentMemory}` : "",
    smartMemoryContext ? `=== RELEVANT MEMORIES ===\n${smartMemoryContext}` : "",
    `=== LOOP TASK ===`,
    `Title: ${task.title}`,
    `Objective: ${loop.objective}`,
    `Success Metric: ${loop.metric}`,
    `Iteration: ${loop.currentIteration + 1} of ${loop.maxIterations}`,
    ``,
    `=== PREVIOUS ITERATIONS ===`,
    historyText,
    ``,
    `=== INSTRUCTIONS ===`,
    `Work toward the objective. Try to improve the metric.`,
    `In your response, include:`,
    `  METRIC: <current value of the metric>`,
    `  OBJECTIVE_MET: true/false`,
    `If the objective is met, we will stop iterating.`,
    `Be concise. Focus on what changed this iteration and what to try next.`,
  ].filter(Boolean).join("\n");

  const result = await spawnAgent(agent, prompt);

  console.log(`[${agent.name}] Loop iteration ${loop.currentIteration + 1} complete`);

  // Parse metric value and objective status
  const metricMatch = result.match(/METRIC:\s*(.+)/i);
  const objectiveMet = /OBJECTIVE_MET:\s*true/i.test(result);
  const metricValue = metricMatch ? metricMatch[1].trim() : undefined;

  // Record iteration
  const newIteration: LoopIteration = {
    iteration: loop.currentIteration + 1,
    result: result.slice(0, 2000),
    metricValue,
    timestamp: new Date().toISOString(),
  };

  const updatedHistory = [...loop.iterationHistory, newIteration];
  const newCurrentIteration = loop.currentIteration + 1;

  // Determine loop status
  let loopStatus: string = "running";
  let taskStatus: string = "in_progress";

  if (objectiveMet) {
    loopStatus = "completed";
    taskStatus = "done";
    console.log(`[${agent.name}] Objective met! Loop task completed.`);
  } else if (newCurrentIteration >= loop.maxIterations) {
    loopStatus = "completed";
    taskStatus = "done";
    console.log(`[${agent.name}] Max iterations reached. Loop task completed.`);
  } else {
    // Check if human paused/stopped the loop
    const refreshedTask = await api<SharedTask[]>("/tasks");
    const current = refreshedTask.find((t) => t.id === task.id);
    if (current?.loopConfig?.status === "paused" || current?.loopConfig?.status === "stopped") {
      loopStatus = current.loopConfig.status;
      taskStatus = "review";
      console.log(`[${agent.name}] Loop ${loopStatus} by user.`);
    }
  }

  // Update task with iteration results
  await api("/tasks", "PATCH", {
    id: task.id,
    status: taskStatus,
    result: result.slice(0, 2000),
    loopConfig: {
      ...loop,
      currentIteration: newCurrentIteration,
      iterationHistory: updatedHistory,
      status: loopStatus,
    },
  });

  // Check if completing this loop task unblocks downstream tasks
  if (taskStatus === "done") {
    await checkAndUnblockDependents(task.id, task.title);
  }

  // Post metrics
  const durationMs = Date.now() - startTime;
  await api("/metrics", "POST", {
    agentId,
    taskId: task.id,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs,
    provider: agent.provider,
    model: agent.model || "",
  });

  // Ingest loop iteration into Smart Memory
  if (smartMemoryAvailable) {
    const sessionId = `${agentId}-loop-${task.id}-iter${newCurrentIteration}`;
    await ingestToSmartMemory(agentId, sessionId, `${task.title} (iter ${newCurrentIteration})`, loop.objective, result.slice(0, 3000));
  }

  await logActivity(agentId, "loop_iteration", `Loop "${task.title}" iter ${newCurrentIteration}/${loop.maxIterations}${metricValue ? ` metric=${metricValue}` : ""}${objectiveMet ? " — OBJECTIVE MET" : ""}`);

  // Mark agent as idle
  busyAgents.delete(agentId);
  await api("/agents", "PATCH", {
    id: agentId,
    status: "idle",
    lastActive: new Date().toISOString(),
    currentTaskId: null,
    currentTaskTitle: null,
    taskStartedAt: null,
  });
}

// --- Project Auto-Completion & Summaries ---

// --- Project Phase Deliberation ---

// All deliberation happens in #engineering with boundary markers per project/phase.
// Markers: "--- START {PHASE}: {projectName} ({projectId}) ---" / "--- END {PHASE}: {projectName} ({projectId}) ---"
const ENGINEERING_CHANNEL = "engineering";

function generateDeliberationId(phase: string, projectId: string): string {
  return `${phase}-${projectId}-${Date.now().toString(36)}`;
}

async function buildDependentProjectContext(project: ProjectConfig): Promise<string> {
  if (!project.dependsOn?.length) return "";
  const allProjects = await api<ProjectConfig[]>("/projects");
  const allTasks = await api<SharedTask[]>("/tasks");
  const sections: string[] = [];

  for (const depId of project.dependsOn) {
    const dep = allProjects.find((p) => p.id === depId);
    if (!dep) continue;
    const depTasks = allTasks.filter((t) => t.project === depId);
    const taskSummary = depTasks
      .filter((t) => t.status === "done")
      .map((t) => `  - ${t.title}: ${t.result?.slice(0, 200) || "completed"}`)
      .join("\n");
    sections.push(
      `**${dep.name}** (${dep.status || "unknown"}):\n${dep.description.slice(0, 300)}\n${taskSummary ? `Completed work:\n${taskSummary}` : "No completed tasks yet."}`
    );
  }

  if (sections.length === 0) return "";
  return `=== DEPENDENT PROJECT CONTEXT ===\nThis project builds on the following prior work:\n\n${sections.join("\n\n")}`;
}

function getDeliberationMessages(allMessages: ChannelMessage[], deliberationId: string): ChannelMessage[] {
  return allMessages.filter((m) => m.deliberationId === deliberationId);
}

// Legacy marker functions — kept for visual dividers in the channel UI only
function phaseMarker(action: "START" | "END", phase: string, project: ProjectConfig): string {
  return `--- ${action} ${phase.toUpperCase()}: ${project.name} (${project.id}) ---`;
}

async function postDelibMessage(channelId: string, from: string, content: string, deliberationId: string) {
  await api("/channel-messages", "POST", { channelId, from, content, deliberationId });
}

/**
 * Consensus-based deliberation ending.
 * After all agents have spoken in a round, each agent is asked if they agree
 * the discussion is ready to move forward. Only when ALL agents say CONSENSUS: yes
 * does the phase transition. If any agent says no, a new round starts.
 * Hard cap at round 7 to prevent infinite loops.
 */
async function checkConsensus(
  agent: AgentConfig,
  project: ProjectConfig,
  phase: "discovery" | "retrospective",
  channelHistory: ChannelMessage[],
  channelId: string,
  deliberationId?: string
): Promise<boolean> {
  // Trim history to stay under ~15K chars to avoid spawn timeout
  const recentMsgs = channelHistory.slice(-15);
  let historyText = "";
  for (const m of recentMsgs) {
    const truncated = m.content.length > 1500 ? m.content.slice(0, 1500) + "..." : m.content;
    historyText += `[${m.from}]: ${truncated}\n`;
  }
  const roleInstructions = await readRoleInstructions(agent.role);

  const phaseGoal = phase === "discovery"
    ? "Your team has been discussing project scope, approach, and risks before execution begins."
    : "Your team has been reflecting on completed work and identifying follow-up actions.";

  const consensusPrompt = `${roleInstructions ? `=== ROLE INSTRUCTIONS ===\n${roleInstructions}\n\n` : ""}=== CONSENSUS CHECK: ${project.name} ===

${phaseGoal}

=== FULL DISCUSSION ===
${historyText}

=== YOUR DECISION ===
As a ${agent.role}, is the team ready to move to execution?

IMPORTANT GUIDELINES FOR YOUR VOTE:
- Vote YES if there is a reasonable execution plan, even if not every detail is settled. Details get resolved during execution, not before.
- Vote NO only if there is a CONCRETE problem that would cause work to FAIL or be WASTED — not theoretical concerns.
- "We should verify X" is NOT a blocker — it's a task to add to the plan.
- "We don't have perfect provenance" is NOT a blocker — run the code and check.
- Only vote NO if you can name a specific action that CANNOT proceed without resolution first.
- Favor momentum. Imperfect execution beats perfect planning.

Respond with EXACTLY one of:
CONSENSUS: yes — [brief reason]
CONSENSUS: no — [ONE specific practical blocker that would cause work to fail]`;

  busyAgents.add(agent.id);
  try {
    await api("/agents", "PATCH", { id: agent.id, status: "working", currentTaskTitle: `Consensus: ${project.name}`, currentChannelId: ENGINEERING_CHANNEL });

    const result = await spawnAgent(agent, consensusPrompt);

    // If agent errored, treat as abstain (not a "no") — skip posting, return true to not block
    if (isAgentError(result)) {
      console.log(`[Orchestrator] ${agent.name} errored during consensus — treating as abstain: ${result.slice(0, 100)}`);
      return true; // Don't block consensus because of a crash
    }

    // Post the consensus vote to the channel (tagged with deliberationId)
    await api("/channel-messages", "POST", {
      channelId,
      from: agent.id,
      content: result.slice(0, 4000),
      deliberationId: deliberationId || undefined,
    });

    // Parse the vote
    const agreed = /CONSENSUS:\s*yes/i.test(result);
    return agreed;
  } finally {
    busyAgents.delete(agent.id);
    await api("/agents", "PATCH", { id: agent.id, status: "idle", currentTaskId: null, currentTaskTitle: null, currentChannelId: null }).catch(() => {});
  }
}

async function runDiscoveryPhase(project: ProjectConfig, idleAgents: AgentConfig[]) {
  if (deliberatingProjects.has(project.id)) return;
  deliberatingProjects.add(project.id);

  try {
    let meta = project.phaseMetadata;

    // Initialize phase if fresh
    if (!meta) {
      const deliberationId = generateDeliberationId("discovery", project.id);
      meta = {
        contributedAgents: [],
        maxRounds: 99,
        currentRound: 1,
        phaseStartedAt: new Date().toISOString(),
        channelId: ENGINEERING_CHANNEL,
        deliberationId,
      };
      await api("/projects", "PATCH", { id: project.id, phase: "discovery", phaseMetadata: meta });

      // Post visual marker + project brief (tagged with deliberationId)
      const attachSummary = project.attachments?.length
        ? `\nAttachments: ${project.attachments.map((a) => a.name).join(", ")}`
        : "";
      await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", phaseMarker("START", "discovery", project), deliberationId);
      await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
        `**Project: ${project.name}**\n\n${project.description}${attachSummary}\n\nTeam, please discuss this project. Consider scope, approach, risks, and any clarifications needed.`,
        deliberationId);
      return;
    }

    const dlId = meta.deliberationId;

    // Timeout safety: 60 minutes max per phase — but don't silently proceed without consensus
    // Check if consensus votes exist first — if agents are voting, don't timeout
    const elapsed = Date.now() - new Date(meta.phaseStartedAt).getTime();
    if (elapsed > 60 * 60 * 1000 && !meta.waitingForHuman) {
      const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`);
      const scopedMsgs = getDeliberationMessages(allChannelMsgs, dlId);
      const consensusVotes = scopedMsgs.filter((m) => m.from !== "orchestrator" && /CONSENSUS:\s*yes/i.test(m.content));
      if (consensusVotes.length > 0) {
        console.log(`[Orchestrator] Discovery timeout for "${project.name}" — but ${consensusVotes.length} consensus votes found, skipping timeout`);
        // Don't timeout — fall through to normal processing
      } else {
        console.log(`[Orchestrator] Discovery timeout for "${project.name}" — escalating to human`);
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
          `--- DISCOVERY TIMED OUT (${project.name}) ---\nAgents could not reach consensus within 60 minutes. Escalating to human for decision.`, dlId);
        await api("/channel-messages", "POST", {
          channelId: "blockers",
          from: "orchestrator",
          content: `@human Discovery for "${project.name}" timed out without consensus after ${meta.currentRound} rounds. Please review #engineering and either:\n1. Resolve the blocking concerns and type "proceed" in #engineering\n2. Or manually generate/edit the task backlog`,
        });
        // Set waitingForHuman so we don't spam this every tick
        meta.waitingForHuman = true;
        await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
        return;
      }
    }

    // If waiting for human input, stay paused.
    // Resume happens via ACTION: resume_deliberation or ACTION: complete_phase
    // in the channel message flow (processChannelMessage → executeAgentActions).
    if (meta.waitingForHuman) {
      return;
    }

    // Find eligible agents
    const eligible = idleAgents.filter(
      (a) => a.role !== "comms" && !meta!.contributedAgents.includes(a.id) && !busyAgents.has(a.id)
    );
    const roleOrder = ["architect", "researcher", "engineer", "qa", "ops"];
    eligible.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

    const agent = eligible[0];
    if (!agent) return;

    // Get ONLY this deliberation's messages
    const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`);
    const scopedHistory = getDeliberationMessages(allChannelMsgs, dlId);
    const historyText = scopedHistory.slice(-15).map((m) => {
      const truncated = m.content.length > 1500 ? m.content.slice(0, 1500) + "..." : m.content;
      return `[${m.from}]: ${truncated}`;
    }).join("\n");
    const roleInstructions = await readRoleInstructions(agent.role);
    const agentMemory = await readAgentMemory(agent.file);

    const agentMessages = scopedHistory.filter((m) => m.from !== "orchestrator");
    const isFirstSpeaker = agentMessages.length === 0;
    const lastSpeaker = agentMessages.length > 0 ? agentMessages[agentMessages.length - 1] : null;

    let taskInstruction: string;
    if (isFirstSpeaker) {
      taskInstruction = `=== YOUR TASK ===
You are the FIRST to speak in this Discovery discussion for "${project.name}".

=== CRITICAL GUIDELINES ===
- MATCH YOUR RESPONSE TO THE PROJECT'S COMPLEXITY. A trivial project ("print hello", "add a button") needs 2-3 sentences and one task. A complex project needs more analysis. Do NOT over-engineer simple things.
- FAVOR MOMENTUM OVER PERFECTION. The goal is to move quickly to execution, not to achieve audit-grade certainty before starting.
- Raise only PRACTICAL blockers — things that would cause work to fail or be wasted. Do NOT block on theoretical concerns, perfect provenance, or exhaustive pre-conditions.
- If something can be verified DURING execution (by running it), don't debate it — just plan to run it.
- Scale your response length to the project scope. Simple = 2-4 sentences. Medium = a short paragraph. Complex = 200-400 words max.

As a ${agent.role}, give your assessment:
1. What's the right technical approach? Be specific about sequence.
2. What's missing or unclear? Only flag things that would actually block work.
3. What should the concrete tasks be? Match the number of tasks to the actual work needed — a one-step job is one task, not three.`;
    } else {
      const previousPoints = agentMessages.map((m) => `[${m.from}]: ${m.content.slice(0, 300)}`).join("\n---\n");
      taskInstruction = `=== YOUR TASK ===
You are joining an ongoing Discovery discussion for "${project.name}".

=== CRITICAL GUIDELINES ===
- MATCH YOUR RESPONSE TO THE PROJECT'S COMPLEXITY. If the first speaker already nailed a simple project in 2 sentences, just agree and move on. Don't inflate a trivial task with unnecessary analysis.
- FAVOR MOMENTUM OVER PERFECTION. The goal is to start execution quickly, not to pre-solve every edge case.
- Only disagree if you see a PRACTICAL flaw that would cause real work to fail. Do NOT escalate implementation details into philosophical debates.
- If a concern can be checked by running code, it's NOT a blocker for starting — it's a task to include in the plan.
- Scale your response to the project scope. If the plan is already clear and simple, a short "agree, let's go" is the best response.

Here's what your teammates have said so far:
${previousPoints}

${lastSpeaker ? `Respond DIRECTLY to ${lastSpeaker.from}'s points.` : ""}

As a ${agent.role}:
1. **AGREE or DISAGREE** with specific points — but only disagree on practical grounds, not theoretical ones.
2. **REFINE** the execution plan — but only if it genuinely needs refining.
3. **ADD** only if something genuinely important was missed.

Do NOT re-litigate settled points. Do NOT pad your response to sound thorough. Brevity on simple projects is a sign of good judgment.`;
    }

    const depContext = await buildDependentProjectContext(project);

    const prompt = [
      roleInstructions ? `=== ROLE INSTRUCTIONS ===\n${roleInstructions}` : "",
      agentMemory ? `=== AGENT IDENTITY ===\n${agentMemory}` : "",
      `=== PROJECT ===\nName: ${project.name}\nDescription: ${project.description}`,
      depContext,
      historyText ? `=== DISCUSSION SO FAR ===\n${historyText}` : "",
      taskInstruction,
    ].filter(Boolean).join("\n\n");

    busyAgents.add(agent.id);
    let result: string;
    try {
      await api("/agents", "PATCH", { id: agent.id, status: "working", currentTaskTitle: `Discovery: ${project.name}`, currentChannelId: ENGINEERING_CHANNEL });
      result = await spawnAgent(agent, prompt);
    } finally {
      busyAgents.delete(agent.id);
      await api("/agents", "PATCH", { id: agent.id, status: "idle", currentTaskId: null, currentTaskTitle: null, currentChannelId: null }).catch(() => {});
    }

    // Don't post error results as discussion messages — skip this agent and retry next tick
    if (isAgentError(result)) {
      console.log(`[Orchestrator] ${agent.name} errored during discovery — skipping: ${result.slice(0, 100)}`);
      return;
    }

    await postDelibMessage(ENGINEERING_CHANNEL, agent.id, result.slice(0, 8000), dlId);

    meta.contributedAgents.push(agent.id);
    await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });

    // Check if round is complete
    const allAgents = await api<AgentConfig[]>("/agents");
    const eligibleTotal = allAgents.filter((a) => a.status !== "paused" && a.role !== "comms");
    const allContributed = eligibleTotal.every((a) => meta!.contributedAgents.includes(a.id));

    if (allContributed) {
      if (meta.currentRound >= 7) {
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", `Maximum rounds reached. Moving to execution.`, dlId);
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", phaseMarker("END", "discovery", project), dlId);
        await transitionToExecution(project, ENGINEERING_CHANNEL);
        return;
      }

      await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
        `--- CONSENSUS CHECK (Round ${meta.currentRound}) ---\nAll agents have spoken. Each agent will now vote on whether we're ready to proceed.`, dlId);

      const scopedForConsensus = getDeliberationMessages(
        await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`), dlId
      );

      const anyBusy = eligibleTotal.some((a) => busyAgents.has(a.id));
      if (anyBusy) {
        console.log(`[Orchestrator] Discovery "${project.name}" — waiting for all agents to be free for consensus`);
        return;
      }

      let allAgreed = true;
      const dissenters: string[] = [];
      for (const a of eligibleTotal) {
        const agreed = await checkConsensus(a, project, "discovery", scopedForConsensus, ENGINEERING_CHANNEL, dlId);
        if (!agreed) {
          allAgreed = false;
          dissenters.push(a.name);
        }
      }

      if (allAgreed) {
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", `All agents agree. Consensus reached. Moving to execution.`, dlId);
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", phaseMarker("END", "discovery", project), dlId);
        await transitionToExecution(project, ENGINEERING_CHANNEL);
      } else {
        // Check if any "no" votes mention needing user input — surface to #blockers
        const latestMessages = getDeliberationMessages(
          await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`), dlId
        );
        const noVotes = latestMessages.filter((m) =>
          m.from !== "orchestrator" && /CONSENSUS:\s*no/i.test(m.content)
        );
        const userBlockers = noVotes.filter((m) =>
          /user.*(input|confirm|provide|decide|answer|resolve|must)|requires.*user|need.*user|@human|user-facing.*blocker|only.*(user|human).*can|human.*(input|confirm|intervention|decision)|awaiting.*(user|human)/i.test(m.content)
        );
        if (userBlockers.length > 0) {
          // Agents need user input — PAUSE deliberation instead of looping
          const blockerSummary = userBlockers.map((m) => {
            const reason = m.content.match(/CONSENSUS:\s*no\s*—\s*([\s\S]*)/i)?.[1]?.slice(0, 300) || m.content.slice(0, 300);
            return `- **${m.from}**: ${reason}`;
          }).join("\n");
          const discoveryBlockerKey = `discovery-pause:${project.id}`;
          if (!notifiedBlockers.has(discoveryBlockerKey)) {
            notifiedBlockers.add(discoveryBlockerKey);
            await api("/channel-messages", "POST", {
              channelId: "blockers",
              from: "orchestrator",
              content: `@human Discovery for "${project.name}" needs your input (Round ${meta.currentRound}):\n\n${blockerSummary}\n\nPlease respond in #engineering to unblock.`,
            });
          }
          meta.waitingForHuman = true;
          meta.waitingReason = blockerSummary.slice(0, 500);
          await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
          await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
            `⏸ Deliberation paused — waiting for your input. See #blockers for details.\nRespond here in #engineering to resume.`, dlId);
          console.log(`[Orchestrator] Discovery "${project.name}" — paused, waiting for human input`);
        } else {
          // No user blockers — agents disagree amongst themselves, continue deliberating
          meta.currentRound++;
          meta.contributedAgents = [];
          await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
          await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
            `--- Round ${meta.currentRound} ---\nNo consensus yet. ${dissenters.join(", ")} raised unresolved concerns. Continue deliberating — address their points.`, dlId);
          console.log(`[Orchestrator] Discovery "${project.name}" — no consensus, continuing to round ${meta.currentRound}`);
        }
      }
    }
  } finally {
    deliberatingProjects.delete(project.id);
  }
}

async function transitionToExecution(project: ProjectConfig, channelId: string) {
  // Set phase to "planning" first — tasks will NOT be assigned until phase is "execution"
  await api("/projects", "PATCH", { id: project.id, phase: "planning" as any });

  // Get SCOPED discovery discussion by deliberationId
  // Only include the final round + consensus votes — not the entire back-and-forth
  const dlId = project.phaseMetadata?.deliberationId || "";
  const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${channelId}`);
  const scopedMsgs = dlId ? getDeliberationMessages(allChannelMsgs, dlId) : allChannelMsgs.slice(-20);

  // Find the last consensus check marker and take everything after it (the final agreed plan)
  const lastConsensusIdx = scopedMsgs.findLastIndex((m) => m.from === "orchestrator" && /CONSENSUS CHECK/i.test(m.content));
  const finalRoundMsgs = lastConsensusIdx >= 0 ? scopedMsgs.slice(lastConsensusIdx) : scopedMsgs.slice(-8);
  // Also grab the last substantive message from each agent before consensus (their final positions)
  const agentFinalPositions = new Map<string, string>();
  for (const m of scopedMsgs) {
    if (m.from !== "orchestrator" && m.from !== "human" && !/CONSENSUS/i.test(m.content)) {
      agentFinalPositions.set(m.from, `[${m.from}]: ${m.content}`);
    }
  }
  const discussion = [
    "=== TEAM'S FINAL POSITIONS ===",
    ...agentFinalPositions.values(),
    "",
    "=== CONSENSUS ROUND ===",
    ...finalRoundMsgs.map((m) => `[${m.from}]: ${m.content}`),
  ].join("\n");
  const allTasks = await api<SharedTask[]>("/tasks");
  const existingTasks = allTasks.filter((t) => t.project === project.id);

  // Read attachment contents for context
  let fileContext = "";
  if (project.attachments?.length) {
    for (const att of project.attachments) {
      try {
        const filePath = att.type === "file" ? path.join(PROJECT_ROOT, att.path) : att.path;
        const content = await fs.readFile(filePath, "utf-8");
        fileContext += `\n--- ${att.name} ---\n${content.slice(0, 5000)}`;
      } catch {}
    }
  }

  const existingTaskList = existingTasks.length > 0
    ? existingTasks.map((t) => `- [${t.id}] "${t.title}" (${t.priority}, ${t.status}): ${t.description?.slice(0, 150) || ""}`).join("\n")
    : "No existing tasks.";

  // Ask orchestrator to create/update task backlog informed by the discussion
  const planPrompt = `You are the orchestrator for project "${project.name}".

=== PROJECT DESCRIPTION ===
${project.description}

${fileContext ? `=== PROJECT FILES ===\n${fileContext}\n` : ""}
=== TEAM DISCUSSION OUTCOME ===
${discussion}

=== EXISTING TASKS ===
${existingTaskList}

=== YOUR JOB ===
Based on the team's agreed plan and the project requirements, produce the final task backlog as a JSON object with three arrays:

1. "create": New tasks to add (array of { "title": string, "description": string, "priority": "P0"|"P1"|"P2", "dependsOn": string[] (titles of other tasks in this list or existing tasks) })
2. "update": Existing tasks to modify (array of { "id": string, "title"?: string, "description"?: string, "priority"?: string })
3. "remove": Task IDs to remove (array of strings)

CRITICAL RULES:
- MATCH TASK COUNT TO ACTUAL COMPLEXITY. A simple project ("print hello") needs exactly 1 task. Don't split trivial work into artificial sub-tasks like "identify entrypoint", "implement change", "verify change" — that's one task. A complex project with genuinely independent workstreams can have many tasks.
- If existing tasks already cover a topic, DO NOT create a duplicate. Update the existing task instead.
- Only use "create" for genuinely NEW work that no existing task covers.
- Use "update" to modify existing tasks based on the discussion (refine descriptions, change priority, etc.)
- Use "remove" for tasks the team flagged as unnecessary or out of scope.
- If existing tasks are mostly good, return small changes — don't recreate everything.
- Incorporate the team's key feedback — adjust scope, add tasks they identified as missing, remove ones they flagged.
- Each task should represent a meaningful unit of DELIVERABLE work, not a process step. "Print hello to the console" is a task. "Research how to print" is not.

Output ONLY valid JSON, no markdown code blocks:
{"create": [...], "update": [...], "remove": []}`;

  console.log(`[Orchestrator] Planning tasks for "${project.name}" informed by discovery...`);

  // Use an available agent for task planning instead of hardcoding Claude
  const agents = await api<AgentConfig[]>("/agents");
  const planningAgent = agents.find((a) => a.status !== "paused") || agents[0];
  let result: string;
  if (planningAgent) {
    result = await spawnAgent(planningAgent, planPrompt);
  } else {
    // Fallback to Claude CLI if no agents exist
    result = await spawnWithStdin("npx", ["@anthropic-ai/claude-code", "-p", "-", "--output-format", "text", "--dangerously-skip-permissions"], planPrompt, "task-planning");
  }

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const plan = JSON.parse(jsonMatch[0]) as {
      create: { title: string; description: string; priority: string; dependsOn?: string[] }[];
      update: { id: string; title?: string; description?: string; priority?: string }[];
      remove: string[];
    };

    // Remove tasks
    for (const taskId of plan.remove || []) {
      await api(`/tasks?id=${taskId}`, "DELETE");
      console.log(`[Orchestrator] Removed task ${taskId}`);
    }

    // Update existing tasks
    for (const upd of plan.update || []) {
      const patch: Record<string, unknown> = { id: upd.id };
      if (upd.title) patch.title = upd.title;
      if (upd.description) patch.description = upd.description;
      if (upd.priority) patch.priority = upd.priority;
      await api("/tasks", "PATCH", patch);
      console.log(`[Orchestrator] Updated task "${upd.title || upd.id}"`);
    }

    // Create new tasks (resolve title-based deps)
    const titleToId = new Map<string, string>();
    // Include existing task titles for dependency resolution
    for (const t of existingTasks) {
      titleToId.set(t.title, t.id);
    }
    for (const raw of plan.create || []) {
      const created = await api<{ id: string }>("/tasks", "POST", {
        title: raw.title,
        description: raw.description || "",
        assignee: "unassigned",
        project: project.id,
        priority: ["P0", "P1", "P2"].includes(raw.priority) ? raw.priority : "P1",
        createdBy: "orchestrator",
      });
      titleToId.set(raw.title, created.id);

      // Resolve deps
      if (raw.dependsOn?.length) {
        const depIds = raw.dependsOn.map((t) => titleToId.get(t)).filter(Boolean);
        if (depIds.length > 0) {
          await api("/tasks", "PATCH", { id: created.id, dependsOn: depIds });
        }
      }
    }

    const summary = `Discovery complete. Task backlog updated: ${plan.create?.length || 0} created, ${plan.update?.length || 0} updated, ${plan.remove?.length || 0} removed.`;
    await api("/channel-messages", "POST", { channelId, from: "orchestrator", content: summary });
    console.log(`[Orchestrator] ${summary}`);
  } catch (err) {
    console.error(`[Orchestrator] Failed to parse task plan:`, err);
    await api("/channel-messages", "POST", {
      channelId,
      from: "orchestrator",
      content: `Discovery complete for "${project.name}". Moving to execution. (Note: automatic task planning failed — please create tasks manually or click the generate button.)`,
    });
  }

  // NOW set phase to execution — backlog is ready, tasks can be assigned
  await api("/projects", "PATCH", { id: project.id, phase: "execution" });
  await logActivity("orchestrator", "phase_transition", `"${project.name}" moved to execution after discovery`);
  console.log(`[Orchestrator] "${project.name}" → execution phase`);
}

async function transitionToRetrospective(project: ProjectConfig, tasks: SharedTask[]) {
  const deliberationId = generateDeliberationId("retro", project.id);
  const meta: ProjectPhaseMetadata = {
    contributedAgents: [],
    maxRounds: 99,
    currentRound: 1,
    phaseStartedAt: new Date().toISOString(),
    channelId: ENGINEERING_CHANNEL,
    deliberationId,
  };
  await api("/projects", "PATCH", { id: project.id, phase: "retrospective", phaseMetadata: meta });

  const taskSummary = tasks
    .filter((t) => t.project === project.id)
    .map((t) => `- **${t.title}** (${t.assignee}): ${t.result?.slice(0, 150) || "no result"}`)
    .join("\n");

  await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", phaseMarker("START", "retrospective", project), deliberationId);
  await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
    `**Retrospective: ${project.name}**\n\nAll ${tasks.filter((t) => t.project === project.id).length} tasks completed. Here's what was done:\n\n${taskSummary}\n\nTeam, discuss: What went well? What could improve? Are there follow-up projects needed? Use ACTION: create_project if so.`,
    deliberationId);

  await logActivity("orchestrator", "phase_transition", `"${project.name}" moved to retrospective`);
  console.log(`[Orchestrator] "${project.name}" → retrospective phase`);
}

async function runRetrospectivePhase(project: ProjectConfig, idleAgents: AgentConfig[]) {
  if (deliberatingProjects.has(project.id)) return;
  deliberatingProjects.add(project.id);

  try {
    const meta = project.phaseMetadata;
    if (!meta) return;

    const dlId = meta.deliberationId;

    // Timeout safety: 60 minutes max — escalate to human instead of auto-completing
    // But first check if consensus is already in progress (agents have voted "CONSENSUS: yes")
    const elapsed = Date.now() - new Date(meta.phaseStartedAt).getTime();
    if (elapsed > 60 * 60 * 1000 && !meta.waitingForHuman) {
      // Check if consensus votes exist — if so, don't timeout, let the flow complete
      const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`);
      const scopedMsgs = getDeliberationMessages(allChannelMsgs, dlId);
      const consensusVotes = scopedMsgs.filter((m) => m.from !== "orchestrator" && /CONSENSUS:\s*yes/i.test(m.content));
      if (consensusVotes.length > 0) {
        console.log(`[Orchestrator] Retro timeout for "${project.name}" — but ${consensusVotes.length} consensus votes found, skipping timeout`);
        // Don't timeout — fall through to normal processing
      } else {
        console.log(`[Orchestrator] Retrospective timeout for "${project.name}" — escalating`);
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
          `--- RETROSPECTIVE TIMED OUT (${project.name}) ---\nAgents could not reach consensus within 60 minutes. Escalating to human.`, dlId);
        await api("/channel-messages", "POST", {
          channelId: "blockers",
          from: "orchestrator",
          content: `@human Retrospective for "${project.name}" timed out without consensus after ${meta.currentRound} rounds. Please review #engineering.`,
        });
        // Set waitingForHuman so we don't spam this every tick
        meta.waitingForHuman = true;
        await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
        return;
      }
    }

    // If waiting for human input, stay paused.
    // Resume happens via ACTION: resume_deliberation or ACTION: complete_phase
    // in the channel message flow (processChannelMessage → executeAgentActions).
    if (meta.waitingForHuman) {
      return;
    }

    const eligible = idleAgents.filter(
      (a) => a.role !== "comms" && !meta.contributedAgents.includes(a.id) && !busyAgents.has(a.id)
    );

    const agent = eligible[0];
    if (!agent) return;

    // Build retro prompt — scoped by deliberationId
    const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`);
    const scopedHistory = getDeliberationMessages(allChannelMsgs, dlId);
    const historyText = scopedHistory.slice(-15).map((m) => {
      const truncated = m.content.length > 1500 ? m.content.slice(0, 1500) + "..." : m.content;
      return `[${m.from}]: ${truncated}`;
    }).join("\n");
    const roleInstructions = await readRoleInstructions(agent.role);
    const agentMemory = await readAgentMemory(agent.file);

    // Get task results for context
    const allTasks = await api<SharedTask[]>("/tasks");
    const projectTasks = allTasks.filter((t) => t.project === project.id);
    const taskResults = projectTasks.map((t) => `- ${t.title}: ${t.result?.slice(0, 200) || "no result"}`).join("\n");

    // Build conversational retro prompt
    const agentMessages = scopedHistory.filter((m) => m.from !== "orchestrator");
    const isFirstSpeaker = agentMessages.length === 0;
    const lastSpeaker = agentMessages.length > 0 ? agentMessages[agentMessages.length - 1] : null;

    let retroInstruction: string;
    if (isFirstSpeaker) {
      retroInstruction = `=== YOUR TASK ===
You are the FIRST to speak in the Retrospective for "${project.name}".

=== GUIDELINES ===
- MATCH YOUR RESPONSE TO THE PROJECT'S COMPLEXITY. If the project was simple (1-2 tasks), keep the retro to 2-3 sentences. Don't write a post-mortem for a trivial task.
- Focus on ACTIONABLE takeaways, not post-hoc analysis.
- If follow-up work is needed, decide: should it happen in THIS project (propose tasks) or a NEW project (propose a project)?
- If the follow-up is a natural extension of this project's scope, say so — the orchestrator will generate new tasks and reopen execution.

Review the completed tasks above. As a ${agent.role}:
1. **What worked?** Brief.
2. **What failed or was wasteful?** Be honest but brief.
3. **What's the next logical step?** If follow-up work belongs in this project, describe the tasks. If it's a different scope, propose a new project.

If you want to create a NEW follow-up project (different scope, ONLY if nothing similar exists in EXISTING PROJECTS above):
ACTION: create_project {"name": "Project Name", "description": "What needs to be done and why"}

IMPORTANT: Check the EXISTING PROJECTS list above before proposing anything. If a similar project already exists, reference it instead of creating a new one.`;
    } else {
      const previousPoints = agentMessages.map((m) => `[${m.from}]: ${m.content.slice(0, 300)}`).join("\n---\n");
      retroInstruction = `=== YOUR TASK ===
You are joining the Retrospective discussion for "${project.name}".

=== GUIDELINES ===
- MATCH YOUR RESPONSE to the project's complexity. Simple project = short retro. Don't pad.
- Don't re-litigate the past. Focus on what to do NEXT.
- Only disagree with a teammate if it changes what the next step should be.
- If a teammate already proposed follow-up work within this project, just agree or refine — don't create a separate project for the same work.
- Do NOT create a project if a teammate already created one in this discussion, or if one already exists in the EXISTING PROJECTS list above. Instead, voice your support or refinements.

Your teammates have said:
${previousPoints}

${lastSpeaker ? `Respond to ${lastSpeaker.from}'s points.` : ""}

As a ${agent.role}:
1. **AGREE or REFINE** the proposed next steps.
2. **PRIORITIZE** — what matters most for the follow-up?
3. **PROPOSE** a follow-up project ONLY if you see a genuinely different need that wasn't mentioned and doesn't exist yet.

If you want to create a follow-up project (ONLY if nothing similar exists):
ACTION: create_project {"name": "Project Name", "description": "What needs to be done and why"}

Don't just agree. Push the discussion forward. But do NOT duplicate existing projects.`;
    }

    // Provide existing projects so agents don't propose duplicates
    const allProjects = await api<ProjectConfig[]>("/projects");
    const existingProjectsList = allProjects
      .filter((p) => p.id !== project.id && (p.status === "active" || p.status === "draft" || p.status === "archived" || p.status === "completed"))
      .map((p) => `- "${p.name}" (${p.status}, phase: ${p.phase || "none"})\n  Requirements: ${p.description?.slice(0, 500) || "no description"}`)
      .join("\n");

    const prompt = [
      roleInstructions ? `=== ROLE INSTRUCTIONS ===\n${roleInstructions}` : "",
      agentMemory ? `=== AGENT IDENTITY ===\n${agentMemory}` : "",
      `=== PROJECT ===\nName: ${project.name}\nDescription: ${project.description}`,
      `=== COMPLETED TASKS ===\n${taskResults}`,
      existingProjectsList ? `=== EXISTING PROJECTS (DO NOT DUPLICATE) ===\nThese projects already exist. Review their requirements carefully — do NOT create a follow-up project if it overlaps with any of these:\n${existingProjectsList}` : "",
      historyText ? `=== FULL DISCUSSION THREAD ===\n${historyText}` : "",
      retroInstruction,
    ].filter(Boolean).join("\n\n");

    busyAgents.add(agent.id);
    let result: string;
    try {
      await api("/agents", "PATCH", { id: agent.id, status: "working", currentTaskTitle: `Retro: ${project.name}`, currentChannelId: ENGINEERING_CHANNEL });
      result = await spawnAgent(agent, prompt);
    } finally {
      busyAgents.delete(agent.id);
      await api("/agents", "PATCH", { id: agent.id, status: "idle", currentTaskId: null, currentTaskTitle: null, currentChannelId: null }).catch(() => {});
    }

    // Don't post error results — skip and retry next tick
    if (isAgentError(result)) {
      console.log(`[Orchestrator] ${agent.name} errored during retro — skipping: ${result.slice(0, 100)}`);
      return;
    }

    // Strip actions from visible message, post to channel (tagged with deliberationId)
    const visibleResult = result.replace(/ACTION:\s*(create_project|create_task|generate_backlog|unblock_task|reassign_task|resume_deliberation|complete_phase)\s*\{[^}]*\}/g, "").trim();
    await postDelibMessage(ENGINEERING_CHANNEL, agent.id, visibleResult.slice(0, 8000), dlId);

    // Execute any actions (create_project, etc.)
    await executeAgentActions(agent.id, agent.name, result, ENGINEERING_CHANNEL);

    // Update contributed agents
    meta.contributedAgents.push(agent.id);
    await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });

    // Check if round is complete
    const allAgents = await api<AgentConfig[]>("/agents");
    const eligibleTotal = allAgents.filter((a) => a.status !== "paused" && a.role !== "comms");
    const allContributed = eligibleTotal.every((a) => meta.contributedAgents.includes(a.id));

    if (allContributed) {
      if (meta.currentRound >= 7) {
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", `Maximum rounds reached. Closing retrospective.`, dlId);
        await completeRetro(project, ENGINEERING_CHANNEL);
        return;
      }

      await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
        `--- CONSENSUS CHECK (Round ${meta.currentRound}) ---\nAll agents have spoken. Each agent will now vote on whether the retrospective is complete.`, dlId);

      const scopedForConsensus = getDeliberationMessages(
        await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`), dlId
      );

      const anyBusyRetro = eligibleTotal.some((a) => busyAgents.has(a.id));
      if (anyBusyRetro) {
        console.log(`[Orchestrator] Retro "${project.name}" — waiting for all agents to be free for consensus`);
        return;
      }

      let allAgreed = true;
      const dissenters: string[] = [];
      for (const a of eligibleTotal) {
        const agreed = await checkConsensus(a, project, "retrospective", scopedForConsensus, ENGINEERING_CHANNEL, dlId);
        if (!agreed) {
          allAgreed = false;
          dissenters.push(a.name);
        }
      }

      if (allAgreed) {
        await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator", `All agents agree. Consensus reached. Closing retrospective.`, dlId);
        await completeRetro(project, ENGINEERING_CHANNEL);
      } else {
        // Surface user-input needs to #blockers
        const latestRetroMsgs = getDeliberationMessages(
          await api<ChannelMessage[]>(`/channel-messages?channel=${ENGINEERING_CHANNEL}`), dlId
        );
        const noVotes = latestRetroMsgs.filter((m) =>
          m.from !== "orchestrator" && /CONSENSUS:\s*no/i.test(m.content)
        );
        const userBlockers = noVotes.filter((m) =>
          /user.*(input|confirm|provide|decide|answer|resolve|must)|requires.*user|need.*user|@human|user-facing.*blocker|only.*(user|human).*can|human.*(input|confirm|intervention|decision)|awaiting.*(user|human)/i.test(m.content)
        );
        if (userBlockers.length > 0) {
          // Agents need user input — PAUSE retro
          const blockerSummary = userBlockers.map((m) => {
            const reason = m.content.match(/CONSENSUS:\s*no\s*—\s*([\s\S]*)/i)?.[1]?.slice(0, 300) || m.content.slice(0, 300);
            return `- **${m.from}**: ${reason}`;
          }).join("\n");
          const retroBlockerKey = `retro-pause:${project.id}`;
          if (!notifiedBlockers.has(retroBlockerKey)) {
            notifiedBlockers.add(retroBlockerKey);
            await api("/channel-messages", "POST", {
              channelId: "blockers",
              from: "orchestrator",
              content: `@human Retrospective for "${project.name}" needs your input (Round ${meta.currentRound}):\n\n${blockerSummary}\n\nPlease respond in #engineering to unblock.`,
            });
          }
          meta.waitingForHuman = true;
          meta.waitingReason = blockerSummary.slice(0, 500);
          await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
          await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
            `⏸ Retrospective paused — waiting for your input. See #blockers for details.\nRespond here in #engineering to resume.`, dlId);
          console.log(`[Orchestrator] Retro "${project.name}" — paused, waiting for human input`);
        } else {
          // Agents disagree amongst themselves — continue deliberating
          meta.currentRound++;
          meta.contributedAgents = [];
          await api("/projects", "PATCH", { id: project.id, phaseMetadata: meta });
          await postDelibMessage(ENGINEERING_CHANNEL, "orchestrator",
            `--- Round ${meta.currentRound} ---\nNo consensus yet. ${dissenters.join(", ")} raised unresolved points. Continue the retrospective.`, dlId);
          console.log(`[Orchestrator] Retro "${project.name}" — no consensus, round ${meta.currentRound}`);
        }
      }
    }
  } finally {
    deliberatingProjects.delete(project.id);
  }
}

/**
 * Complete a retrospective: check if the team proposed follow-up work,
 * then either generate new tasks (same project) or close the project.
 */
async function completeRetro(project: ProjectConfig, channelId: string) {
  await api("/channel-messages", "POST", {
    channelId,
    from: "orchestrator",
    content: phaseMarker("END", "retrospective", project),
  });

  // Check for follow-up projects created during retro (via ACTION: create_project)
  const allProjects = await api<ProjectConfig[]>("/projects");
  const draftFollowUps = allProjects.filter(
    (p) => p.status === "draft" && p.createdAt && new Date(p.createdAt).getTime() > new Date(project.phaseMetadata?.phaseStartedAt || 0).getTime()
  );

  if (draftFollowUps.length > 0) {
    // Follow-up projects were created — close this project and activate them
    await api("/projects", "PATCH", { id: project.id, phase: "completed", status: "completed" });
    await logActivity("orchestrator", "project_completed", `"${project.name}" completed after retrospective`);
    console.log(`[Orchestrator] "${project.name}" → completed`);
    for (const followUp of draftFollowUps) {
      await api("/projects", "PATCH", { id: followUp.id, status: "active", phase: null });
      await api("/channel-messages", "POST", {
        channelId,
        from: "orchestrator",
        content: `Follow-up project "${followUp.name}" auto-activated. Discovery will begin next tick.`,
      });
      await logActivity("orchestrator", "phase_transition", `Auto-activated follow-up project "${followUp.name}" from "${project.name}" retro`);
      console.log(`[Orchestrator] Auto-activated follow-up: "${followUp.name}"`);
    }
    return;
  }

  // No follow-up projects — check if the retro discussion proposed follow-up TASKS
  // (agents agreeing on next steps within the same project)
  const dlId = project.phaseMetadata?.deliberationId || "";
  const allChannelMsgs = await api<ChannelMessage[]>(`/channel-messages?channel=${channelId}`);
  const scopedMsgs = dlId ? getDeliberationMessages(allChannelMsgs, dlId) : [];
  const agentMessages = scopedMsgs.filter((m) => m.from !== "orchestrator" && m.from !== "human" && !/CONSENSUS/i.test(m.content));

  // Check if agents proposed actionable follow-up work (keywords that suggest new tasks)
  const followUpSignals = agentMessages.some((m) =>
    /next step|follow.?up|should (add|create|build|implement|wire|extend)|priority.?\d|regression target|first-class|promote.*into|add.*to.*harness/i.test(m.content)
  );

  if (followUpSignals && agentMessages.length > 0) {
    // Agents proposed follow-up tasks — reopen the project for a new execution cycle
    console.log(`[Orchestrator] Retro for "${project.name}" proposed follow-up work — generating new tasks`);
    await api("/channel-messages", "POST", {
      channelId,
      from: "orchestrator",
      content: `Retrospective complete for "${project.name}". Team proposed follow-up work — generating new tasks and reopening for execution.`,
    });

    // Use transitionToExecution to generate tasks from the retro discussion
    await transitionToExecution(project, channelId);
    await logActivity("orchestrator", "phase_transition", `"${project.name}" reopened for follow-up work after retrospective`);
    console.log(`[Orchestrator] "${project.name}" → reopened for execution with new tasks`);
  } else {
    // No follow-up work proposed — close the project
    await api("/projects", "PATCH", { id: project.id, phase: "completed", status: "completed" });
    await logActivity("orchestrator", "project_completed", `"${project.name}" completed after retrospective`);
    console.log(`[Orchestrator] "${project.name}" → completed`);
    await api("/channel-messages", "POST", {
      channelId,
      from: "orchestrator",
      content: `Retrospective complete for "${project.name}". No follow-up work proposed. Project closed.`,
    });
  }
}

// --- Project Completion (routes through retrospective) ---

async function checkProjectCompletion(tasks: SharedTask[], projects: ProjectConfig[]) {
  for (const project of projects) {
    if (project.status !== "active") continue;
    const projectTasks = tasks.filter((t) => t.project === project.id);
    if (projectTasks.length === 0) continue;
    const allDone = projectTasks.every((t) => t.status === "done");
    if (!allDone) continue;

    // If in execution phase (or no phase), transition to retrospective
    if (!project.phase || project.phase === "execution") {
      await transitionToRetrospective(project, tasks);
    }
    // If already in retrospective or completed, don't touch it
  }
}

async function postProjectSummaries(tasks: SharedTask[], projects: ProjectConfig[]) {
  const activeProjects = projects.filter((p) => p.status === "active");
  if (activeProjects.length === 0) return;

  for (const project of activeProjects) {
    const projectTasks = tasks.filter((t) => t.project === project.id);
    if (projectTasks.length === 0) continue;

    const done = projectTasks.filter((t) => t.status === "done").length;
    const inProgress = projectTasks.filter((t) => t.status === "in_progress").length;
    const blocked = projectTasks.filter((t) => t.blocked).length;
    const total = projectTasks.length;

    const summaryText = `Project "${project.name}" status: ${done}/${total} done, ${inProgress} in progress, ${blocked} blocked`;

    // Only post if the summary has changed since last time
    if (lastProjectSummary.get(project.id) === summaryText) continue;
    lastProjectSummary.set(project.id, summaryText);

    await api("/channel-messages", "POST", {
      channelId: "general",
      from: "orchestrator",
      content: summaryText,
    });
  }
  console.log(`[Orchestrator] Posted summaries for ${activeProjects.length} active project(s)`);
}

// --- Dependency-Aware Notifications ---

async function checkAndUnblockDependents(completedTaskId: string, completedTitle: string) {
  const tasks = await api<SharedTask[]>("/tasks");
  for (const task of tasks) {
    if (!task.dependsOn?.includes(completedTaskId)) continue;
    if (task.status === "done") continue;

    const allDepsResolved = task.dependsOn.every((depId) => {
      const dep = tasks.find((d) => d.id === depId);
      return dep?.status === "done";
    });
    if (!allDepsResolved) continue;

    // Unblock if it was blocked due to dependencies — but NOT if it's waiting for human input
    if (task.blocked) {
      const needsHuman = /human|input|decision|approval|permission|clarif|confirm|access|credential|secret|key|token/i.test(task.blockedReason || "");
      if (!needsHuman) {
        await api("/tasks", "PATCH", { id: task.id, blocked: false, blockedReason: undefined });
        // Clear blocker dedup so it can notify again if re-blocked
        notifiedBlockers.delete(`task-blocked:${task.id}`);
        notifiedBlockers.delete(`task-error:${task.id}`);
      } else {
        console.log(`[Orchestrator] Skipping auto-unblock for "${task.title}" — waiting for human input: ${task.blockedReason}`);
      }
    }

    await api("/channel-messages", "POST", {
      channelId: "general",
      from: "orchestrator",
      content: `"${completedTitle}" completed — "${task.title}" is now unblocked and ready for assignment.`,
    });
    console.log(`[Orchestrator] Unblocked "${task.title}" after "${completedTitle}" completed`);
  }
}

// --- Deadlock Detection ---

function detectCircularDependency(tasks: SharedTask[], taskId: string, dependsOn: string[]): boolean {
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

async function checkForDeadlocks(tasks: SharedTask[]) {
  const blockedWithDeps = tasks.filter((t) =>
    (t.status === "todo" || t.status === "in_progress") &&
    t.blocked &&
    t.dependsOn?.length
  );
  if (blockedWithDeps.length < 2) return;

  const blockedIds = new Set(blockedWithDeps.map((t) => t.id));
  const deadlocked = blockedWithDeps.filter((t) =>
    t.dependsOn!.some((depId) => blockedIds.has(depId))
  );
  if (deadlocked.length < 2) return;

  const cycle = detectCircularDependency(tasks, deadlocked[0].id, deadlocked[0].dependsOn || []);
  if (!cycle) return;

  const deadlockKey = deadlocked.map((t) => t.id).sort().join(",");
  if (reportedDeadlocks.has(deadlockKey)) return;

  reportedDeadlocks.add(deadlockKey);
  const titles = deadlocked.map((t) => `"${t.title}"`).join(", ");
  console.error(`[Orchestrator] DEADLOCK DETECTED: ${titles}`);

  await api("/channel-messages", "POST", {
    channelId: "blockers",
    from: "orchestrator",
    content: `@human DEADLOCK DETECTED: Tasks ${titles} have circular dependencies and are blocking each other. Manual intervention needed to break the cycle.`,
  });
}

// --- Agent Pool Scaling ---

async function getPoolConfig(): Promise<AgentPoolConfig | null> {
  try {
    return await api<AgentPoolConfig>("/pool-config");
  } catch {
    return null;
  }
}

async function scaleAgentPool(agents: AgentConfig[], unassignedTaskCount: number) {
  const config = await getPoolConfig();
  if (!config?.enabled) return;

  const activeAgents = agents.filter((a) => a.status !== "paused");
  const idleAgents = activeAgents.filter((a) => !busyAgents.has(a.id));

  // --- Scale Up ---
  if (unassignedTaskCount >= config.scaleUpThreshold && idleAgents.length === 0 && activeAgents.length < config.maxAgents) {
    // First: try to reactivate a paused auto-scaled agent
    const pausedAutoScaled = agents.find((a) => a.status === "paused" && a.autoScaled);
    if (pausedAutoScaled) {
      await api("/agents", "PATCH", { id: pausedAutoScaled.id, status: "idle" });
      console.log(`[Pool] Reactivated ${pausedAutoScaled.name} to handle backlog`);
      await api("/channel-messages", "POST", {
        channelId: "general",
        from: "orchestrator",
        content: `Scaling up: reactivated ${pausedAutoScaled.name} to handle ${unassignedTaskCount} queued task(s).`,
      });
      return;
    }

    // Otherwise: create a new agent from pool config
    // Pick a provider with capacity
    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      const providerAgents = activeAgents.filter((a) => a.provider === provider);
      if (providerAgents.length >= providerConfig.maxInstances) continue;

      // Generate name: "Claude-2", "Claude-3", etc.
      const providerAllAgents = agents.filter((a) => a.provider === provider);
      const instanceNum = providerAllAgents.length + 1;
      const baseName = provider.charAt(0).toUpperCase() + provider.slice(1);
      const agentName = `${baseName}-${instanceNum}`;

      try {
        const newAgent = await api<AgentConfig>("/agents", "POST", {
          name: agentName,
          provider,
          model: providerConfig.defaultModel || "",
          role: providerConfig.defaultRole,
          roleFile: `roles/${providerConfig.defaultRole}.md`,
          instructions: "",
        });

        // Mark as auto-scaled
        if (newAgent?.id) {
          await api("/agents", "PATCH", { id: newAgent.id, autoScaled: true });
          console.log(`[Pool] Created ${agentName} (auto-scaled) to handle backlog`);
          await api("/channel-messages", "POST", {
            channelId: "general",
            from: "orchestrator",
            content: `Scaling up: created ${agentName} to handle ${unassignedTaskCount} queued task(s).`,
          });
        }
      } catch (err) {
        console.error(`[Pool] Failed to create agent:`, err);
      }
      return; // Only create one agent per tick
    }
  }

  // --- Scale Down ---
  const idleTimeoutMs = config.scaleDownAfterIdleMinutes * 60 * 1000;
  const now = Date.now();

  for (const agent of idleAgents) {
    if (!agent.autoScaled) continue; // Never scale down user-created agents
    if (!agent.lastActive) continue;

    const idleFor = now - new Date(agent.lastActive).getTime();
    if (idleFor > idleTimeoutMs) {
      await api("/agents", "PATCH", { id: agent.id, status: "paused" });
      console.log(`[Pool] Paused ${agent.name} (idle for ${Math.round(idleFor / 60000)} min)`);
      await api("/channel-messages", "POST", {
        channelId: "general",
        from: "orchestrator",
        content: `Scaling down: paused ${agent.name} (idle for ${Math.round(idleFor / 60000)} min). Will reactivate if needed.`,
      });
    }
  }
}

async function tick() {
  try {
    // Get agents and tasks
    const agents = await api<AgentConfig[]>("/agents");
    const tasks = await api<SharedTask[]>("/tasks");

    // --- Stale agent recovery (runs every tick) ---
    // If an agent is "working" in the DB but NOT in our busyAgents Set,
    // it means its process finished/crashed but cleanup didn't fire. Reset it.
    for (const agent of agents) {
      if (agent.status === "working" && !busyAgents.has(agent.id)) {
        console.log(`[Orchestrator] Stale agent detected: ${agent.name} is "working" but has no active process — resetting to idle`);

        // If this agent had an in_progress task, move it back to todo
        const staleTaskId = agent.currentTaskId;
        if (staleTaskId) {
          const stuckTask = tasks.find((t) => t.id === staleTaskId && t.status === "in_progress");
          if (stuckTask) {
            await api("/tasks", "PATCH", { id: stuckTask.id, status: "todo", assignee: "unassigned" });
            stuckTask.status = "todo";
            stuckTask.assignee = "unassigned";
            console.log(`[Orchestrator] Reset stuck task "${stuckTask.title}" back to todo`);
          }
        }

        // Reset agent to idle
        await api("/agents", "PATCH", {
          id: agent.id,
          status: "idle",
          currentTaskId: null,
          currentTaskTitle: null,
          taskStartedAt: null,
          currentChannelId: null,
        });
        agent.status = "idle";
        agent.currentTaskId = null;
        agent.currentTaskTitle = null;
        agent.currentChannelId = null;
      }
    }

    // Find idle, active agents
    const idleAgents = agents.filter(
      (a) => a.status !== "paused" && !busyAgents.has(a.id)
    );

    // First: check for unread messages for idle agents
    for (const agent of idleAgents) {
      const unread = await api<AgentMessage[]>(`/messages?for=${agent.id}`);
      if (unread.length > 0) {
        processMessage(agent, unread).catch((err) => {
          console.error(`[${agent.name}] Message reply failed:`, err);
          busyAgents.delete(agent.id);
        });
        continue; // Don't also assign a task this tick
      }
    }

    // Check for new channel messages from humans that need a response
    const stillIdleAfterDMs = idleAgents.filter((a) => !busyAgents.has(a.id));
    if (stillIdleAfterDMs.length > 0) {
      const allChannelMsgs = await api<ChannelMessage[]>("/channel-messages");
      const newHumanMsgs = allChannelMsgs.filter(
        (m) => m.from === "human" &&
          !processedChannelMessages.has(m.id) &&
          m.timestamp > orchestratorStartTime // ignore messages from before this startup
      );
      for (const msg of newHumanMsgs) {
        // Prefer comms agent for channel responses, fallback to any idle agent
        const commsAgent = stillIdleAfterDMs.find((a) => a.role === "comms" && !busyAgents.has(a.id));
        const idle = commsAgent || stillIdleAfterDMs.find((a) => !busyAgents.has(a.id));
        if (!idle) break;
        processChannelMessage(idle, msg).catch((err) => {
          console.error(`[${idle.name}] Channel reply failed:`, err);
          busyAgents.delete(idle.id);
        });
      }
    }

    // Re-check who's still idle after message assignments
    const stillIdle = idleAgents.filter((a) => !busyAgents.has(a.id));

    // Fetch projects (full data for phase checking)
    const projects = await api<ProjectConfig[]>("/projects");
    const activeProjects = new Set(projects.filter((p) => p.status === "active").map((p) => p.id));

    // --- Auto-pickup: activate draft projects if setting is enabled ---
    try {
      const settings = await api<{ autoPickup?: boolean }>("/settings");
      if (settings.autoPickup) {
        for (const project of projects as ProjectConfig[]) {
          if ((!project.status || project.status === "draft") && project.description && project.description.trim().length > 0) {
            await api("/projects", "PATCH", { id: project.id, status: "active" });
            project.status = "active";
            activeProjects.add(project.id);
            console.log(`[Orchestrator] Auto-pickup: activated draft project "${project.name}"`);
            await logActivity("orchestrator", "auto_pickup", `Auto-activated project "${project.name}"`);
          }
        }
      }
    } catch {}

    // --- Initialize phases on newly activated projects BEFORE task assignment ---
    for (const project of projects as ProjectConfig[]) {
      if (project.status !== "active") continue;
      if (!project.phase) {
        await api("/projects", "PATCH", { id: project.id, phase: "discovery" });
        project.phase = "discovery";
        console.log(`[Orchestrator] "${project.name}" activated → entering discovery phase`);
      }
    }

    // Helper: check if a task is eligible for assignment
    // Tasks in active/execution projects are always eligible.
    // Tasks in completed projects are eligible ONLY if manually created (human added work after retro).
    // Tasks in discovery/retrospective/draft/archived projects are NOT eligible.
    const isProjectActive = (t: SharedTask) => {
      if (!t.project) return true;
      const proj = projects.find((p) => p.id === t.project);
      if (!proj) return true;
      if (proj.status === "active" && proj.phase === "execution") return true;
      // Allow manually created tasks in completed projects to be picked up
      if (proj.status === "completed" && t.createdBy === "human") return true;
      return false;
    };

    // Helper: check if all dependencies are resolved (done)
    const depsResolved = (t: SharedTask) =>
      !t.dependsOn?.length || t.dependsOn.every((depId) => {
        const dep = tasks.find((d) => d.id === depId);
        return dep?.status === "done";
      });

    // Find assignable tasks: unassigned todos, active project, not blocked, deps resolved
    const agentIds = new Set(agents.map((a) => a.id));
    const isUnassigned = (a: string | undefined | null) => !a || a === "unassigned" || a === "none" || !agentIds.has(a);
    const todoTasks = tasks.filter(
      (t) => t.status === "todo" && isUnassigned(t.assignee) && !t.blocked && isProjectActive(t) && depsResolved(t)
    );

    // Sort by priority: P0 first, then P1, then P2
    todoTasks.sort((a, b) => a.priority.localeCompare(b.priority));

    // Agent pool scaling: scale up if needed, scale down idle auto-scaled agents
    await scaleAgentPool(agents, todoTasks.length);

    // Re-fetch agents after potential scaling (new agents may have been created)
    const postScaleAgents = await api<AgentConfig[]>("/agents");
    const postScaleIdle = postScaleAgents.filter((a) => a.status !== "paused" && !busyAgents.has(a.id));

    // Assign tasks to idle agents (use post-scale list to include newly created agents)
    for (const agent of postScaleIdle) {
      // Check if this agent has a task specifically assigned to them
      const assignedTask = tasks.find(
        (t) => t.assignee === agent.id && t.status === "todo" && !t.blocked && isProjectActive(t) && depsResolved(t)
      );

      // Role affinity: prefer tasks matching this agent's role
      let task = assignedTask;
      if (!task) {
        const affinityIdx = todoTasks.findIndex((t) => t.preferredRole === agent.role);
        if (affinityIdx !== -1) {
          task = todoTasks.splice(affinityIdx, 1)[0];
        } else {
          task = todoTasks.shift();
        }
      }
      if (!task) continue;

      // Route loop tasks to processLoopTask, standard tasks to processTask
      const isLoopTask = task.taskType === "loop" && task.loopConfig && task.loopConfig.status === "running";
      const processFn = isLoopTask
        ? processLoopTask(agent, task as SharedTask & { loopConfig: LoopConfig })
        : processTask(agent, task);

      processFn.catch((err) => {
        console.error(`[${agent.name}] Task failed:`, err);
        busyAgents.delete(agent.id);
      });
    }
    // --- Deadlock detection ---
    await checkForDeadlocks(tasks);

    // --- Idle agent alert (deduplicated: once per 5 minutes) ---
    const remainingIdle = stillIdle.filter((a) => !busyAgents.has(a.id));
    if (remainingIdle.length > 0 && todoTasks.length > 0) {
      const now = Date.now();
      if (now - lastIdleAlertTime > 5 * 60 * 1000) {
        lastIdleAlertTime = now;
        await api("/channel-messages", "POST", {
          channelId: "general",
          from: "orchestrator",
          content: `Alert: ${remainingIdle.length} idle agent(s) with ${todoTasks.length} task(s) in backlog. Check for assignment issues.`,
        });
        console.log(`[Orchestrator] Posted idle alert: ${remainingIdle.length} idle, ${todoTasks.length} tasks`);
      }
    }

    // --- Route review tasks to QA agent for verification ---
    // No auto-approve: tasks stay in review until an agent is available to review them
    const reviewTasks = tasks.filter((t) => t.status === "review" && !busyAgents.has(t.assignee));
    if (reviewTasks.length > 0) {
      // Prefer QA agent, fall back to any idle non-comms agent
      const qaAgent = postScaleIdle.find((a) => a.role === "qa" && !busyAgents.has(a.id));
      const reviewAgent = qaAgent || postScaleIdle.find((a) => a.role !== "comms" && !busyAgents.has(a.id));

      if (reviewAgent) {
        for (const task of reviewTasks) {
          if (busyAgents.has(reviewAgent.id)) break; // Only one review per tick per agent
          processReviewTask(reviewAgent, task).catch((err) => {
            console.error(`[${reviewAgent.name}] Review failed:`, err);
            busyAgents.delete(reviewAgent.id);
          });
        }
      }
      // If no agent available, tasks stay in review — they'll be picked up next tick
    }

    // --- Agent Deliberation Phases ---
    for (const project of projects as ProjectConfig[]) {
      if (project.status !== "active") continue;

      if (project.phase === "discovery") {
        const currentIdle = postScaleIdle.filter((a) => !busyAgents.has(a.id));
        await runDiscoveryPhase(project, currentIdle);
      }

      if (project.phase === "retrospective") {
        const currentIdle = postScaleIdle.filter((a) => !busyAgents.has(a.id));
        await runRetrospectivePhase(project, currentIdle);
      }
    }

    // --- Project completion (routes through retrospective) ---
    await checkProjectCompletion(tasks, projects as ProjectConfig[]);

    // --- Periodic project status summaries (every 30 ticks = ~5 min) ---
    tickCount++;
    if (tickCount % 30 === 0) {
      await postProjectSummaries(tasks, projects as ProjectConfig[]);
    }

  } catch (err) {
    console.error("[Orchestrator] Tick error:", err);
  }
}

async function logTaskCount() {
  const tasks = await api<SharedTask[]>("/tasks");
  console.log(`[Orchestrator] ${tasks.length} task(s) on the board.`);
}

// --- Entry Point ---

async function main() {
  console.log("===========================================");
  console.log("  Mission Control Orchestrator");
  console.log("  Connecting to: " + API_BASE);
  console.log("===========================================\n");

  // Verify API is up
  try {
    await fetch(`${API_BASE}/agents`);
    console.log("[Orchestrator] API is reachable.\n");
  } catch {
    console.error("[Orchestrator] Cannot reach API at " + API_BASE);
    console.error("Make sure Mission Control is running: npm run dev");
    process.exit(1);
  }

  // Check Smart Memory
  smartMemoryAvailable = await checkSmartMemory();
  if (smartMemoryAvailable) {
    console.log("[Orchestrator] Smart Memory is available at " + SMART_MEMORY_BASE);
  } else {
    console.log("[Orchestrator] Smart Memory not available — using static .md files only");
  }

  // Log startup
  const memoryStatus = smartMemoryAvailable ? " + Smart Memory" : "";
  await logActivity("orchestrator", "started", `Orchestrator started${memoryStatus} — watching for tasks`);

  await logTaskCount();

  // Print registered agents and reset stale "working" statuses
  const agents = await api<AgentConfig[]>("/agents");
  console.log(`[Orchestrator] ${agents.length} agents registered:`);
  for (const a of agents) {
    if (a.status === "working") {
      await api("/agents", "PATCH", {
        id: a.id,
        status: "idle",
        currentTaskId: null,
        currentTaskTitle: null,
        taskStartedAt: null,
        currentChannelId: null,
      });
      console.log(`  - ${a.name} (${a.provider}) [${a.role}] — was "working", reset to idle`);
    } else {
      console.log(`  - ${a.name} (${a.provider}) [${a.role}] — ${a.status}`);
    }
  }

  // Reset orphaned in_progress tasks (from previous crash/restart)
  const tasks = await api<SharedTask[]>("/tasks");
  const orphanedTasks = tasks.filter((t) => t.status === "in_progress");
  for (const task of orphanedTasks) {
    await api("/tasks", "PATCH", { id: task.id, status: "todo", assignee: "unassigned" });
    console.log(`  [Startup] Reset orphaned task: "${task.title}" (in_progress → todo)`);
  }

  // Reset projects with stale phases (e.g., in execution/retro but no tasks)
  const allProjects = await api<ProjectConfig[]>("/projects");
  for (const proj of allProjects) {
    if (proj.status !== "active" || !proj.phase) continue;
    const projectTasks = tasks.filter((t) => t.project === proj.id);
    if (projectTasks.length === 0 && (proj.phase === "execution" || proj.phase === "retrospective")) {
      await api("/projects", "PATCH", { id: proj.id, phase: "discovery", phaseMetadata: null });
      console.log(`  [Startup] Reset stale project "${proj.name}" (${proj.phase} with no tasks → discovery)`);
    }
  }

  console.log(`\n[Orchestrator] Polling every ${POLL_INTERVAL / 1000}s...\n`);

  // Start the loop
  await tick(); // Run immediately
  setInterval(tick, POLL_INTERVAL);
}

// --- Graceful Shutdown ---
async function shutdown(signal: string) {
  console.log(`\n[Orchestrator] ${signal} received — shutting down...`);

  // Kill all active child processes
  if (activeChildProcesses.size > 0) {
    console.log(`[Orchestrator] Killing ${activeChildProcesses.size} active agent process(es)...`);
    for (const proc of activeChildProcesses) {
      try { proc.kill("SIGTERM"); } catch {}
    }
  }

  // Reset all agents to idle so next startup is clean
  try {
    const agents = await api<AgentConfig[]>("/agents");
    for (const a of agents) {
      if (a.status === "working") {
        await api("/agents", "PATCH", {
          id: a.id,
          status: "idle",
          currentTaskId: null,
          currentTaskTitle: null,
          taskStartedAt: null,
          currentChannelId: null,
        });
      }
    }
    // Reset in-progress tasks back to todo
    const tasks = await api<SharedTask[]>("/tasks");
    for (const t of tasks) {
      if (t.status === "in_progress") {
        await api("/tasks", "PATCH", { id: t.id, status: "todo", assignee: "unassigned" });
      }
    }
    await logActivity("orchestrator", "stopped", "Orchestrator stopped gracefully");
    console.log("[Orchestrator] State cleaned up. Goodbye.");
  } catch {
    console.log("[Orchestrator] Could not reach API for cleanup — state will be recovered on next startup.");
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
