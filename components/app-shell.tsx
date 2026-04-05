"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  ScreenId,
  MissionControlSnapshot,
  SharedTask,
  AgentMessage,
  AgentActivity,
  AgentConfig,
  AgentProvider,
  AgentMetrics,
  ProjectConfig,
  DocEntry,
  Channel,
  ChannelMessage,
} from "@/lib/mission-control-data";
import { Sidebar } from "@/components/sidebar";
import { TaskBoard } from "@/components/task-board";
import { CalendarScreen } from "@/components/calendar-screen";
import { ProjectsScreen } from "@/components/projects-screen";
import { MemoryScreen } from "@/components/memory-screen";
import { DocsScreen } from "@/components/docs-screen";
import { ChannelScreen } from "@/components/channel-screen";
import { TeamScreen } from "@/components/team-screen";
import { OfficeScreen } from "@/components/office-screen";
import { SettingsScreen } from "@/components/settings-screen";
import { ApprovalsScreen } from "@/components/approvals-screen";

const screenTitles: Record<ScreenId, string> = {
  "task-board": "Tasks",
  calendar: "Calendar",
  projects: "Projects",
  memory: "Memory",
  docs: "Docs",
  team: "Team",
  office: "Office",
  channel: "Channel",
  settings: "Settings",
  approvals: "Approvals",
};

async function apiFetch<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${endpoint}`, opts);
  return res.json() as Promise<T>;
}

export function MissionControlAppShell({ initialData }: { initialData: MissionControlSnapshot }) {
  const [data, setData] = useState(initialData);
  const [activeScreen, setActiveScreen] = useState<ScreenId>("task-board");
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Multi-agent state
  const [sharedTasks, setSharedTasks] = useState<SharedTask[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [agentDocs, setAgentDocs] = useState<DocEntry[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [metrics, setMetrics] = useState<AgentMetrics[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [orchestratorStarting, setOrchestratorStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Unread message tracking — stores last-read timestamp per channel in localStorage
  const [channelLastRead, setChannelLastRead] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("mc-channel-last-read") || "{}"); } catch { return {}; }
  });

  const channelUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ch of channels) {
      const lastRead = channelLastRead[ch.id] || "1970-01-01T00:00:00Z";
      counts[ch.id] = channelMessages.filter(
        (m) => m.channelId === ch.id && m.timestamp > lastRead && m.from !== "human"
      ).length;
    }
    return counts;
  }, [channels, channelMessages, channelLastRead]);

  const markChannelRead = useCallback((channelId: string) => {
    const now = new Date().toISOString();
    setChannelLastRead((prev) => {
      const next = { ...prev, [channelId]: now };
      localStorage.setItem("mc-channel-last-read", JSON.stringify(next));
      return next;
    });
  }, []);

  // Poll multi-agent APIs
  const pollAgentData = useCallback(async () => {
    try {
      const [t, m, a, ag, orch, prj, docs, ch, chm, met] = await Promise.all([
        apiFetch<SharedTask[]>("/tasks"),
        apiFetch<AgentMessage[]>("/messages"),
        apiFetch<AgentActivity[]>("/activity"),
        apiFetch<AgentConfig[]>("/agents"),
        apiFetch<{ running: boolean }>("/orchestrator"),
        apiFetch<ProjectConfig[]>("/projects"),
        apiFetch<DocEntry[]>("/docs"),
        apiFetch<Channel[]>("/channels"),
        apiFetch<ChannelMessage[]>("/channel-messages"),
        apiFetch<AgentMetrics[]>("/metrics"),
      ]);
      setSharedTasks(t);
      setMessages(m);
      setActivity(a);
      setAgents(ag);
      setOrchestratorRunning(orch.running);
      setProjects(prj);
      setAgentDocs(docs);
      setChannels(ch);
      setChannelMessages(chm);
      setMetrics(met);
    } catch {
      // API might not be ready yet
    }
  }, []);

  useEffect(() => {
    pollAgentData();
    pollRef.current = setInterval(pollAgentData, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollAgentData]);

  const counts: Partial<Record<ScreenId, number>> = {
    "task-board": sharedTasks.length,
    calendar: data.calendarItems.length,
    projects: projects.length,
    memory: data.memoryEntries.length,
    docs: agentDocs.length,
    team: agents.length,
    office: data.officeSeats.length,
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [snapshot] = await Promise.all([
        apiFetch<MissionControlSnapshot>("/mission-control"),
        pollAgentData(),
      ]);
      setData(snapshot);
    } finally {
      setRefreshing(false);
    }
  }, [pollAgentData]);

  // Orchestrator controls
  const toggleOrchestrator = useCallback(async () => {
    setOrchestratorStarting(true);
    try {
      const action = orchestratorRunning ? "stop" : "start";
      await apiFetch("/orchestrator", "POST", { action });
      // Give it a moment to start/stop
      setTimeout(async () => {
        await pollAgentData();
        setOrchestratorStarting(false);
      }, 1500);
    } catch {
      setOrchestratorStarting(false);
    }
  }, [orchestratorRunning, pollAgentData]);

  // Agent actions
  const handleSpawnAgent = useCallback(async (agentData: {
    name: string; provider: AgentProvider; model: string; role: string; roleFile: string; instructions: string; reasoningEffort?: string; sandbox?: string;
  }) => {
    const res = await apiFetch("/agents", "POST", agentData);
    // If codex-specific fields were provided, patch them onto the agent
    if (agentData.provider === "codex" && (agentData.reasoningEffort || agentData.sandbox)) {
      const agent = res as { id: string };
      await apiFetch("/agents", "PATCH", {
        id: agent.id,
        ...(agentData.reasoningEffort ? { reasoningEffort: agentData.reasoningEffort } : {}),
        ...(agentData.sandbox ? { sandbox: agentData.sandbox } : {}),
      });
    }
    await pollAgentData();
  }, [pollAgentData]);

  const handleSwitchProvider = useCallback(async (id: string, provider: AgentProvider) => {
    await apiFetch("/agents", "PATCH", { id, provider });
    await pollAgentData();
  }, [pollAgentData]);

  const handleDeleteAgent = useCallback(async (id: string) => {
    await apiFetch(`/agents?id=${id}`, "DELETE");
    await pollAgentData();
  }, [pollAgentData]);

  const handleSendMessage = useCallback(async (to: string, content: string) => {
    await apiFetch("/messages", "POST", { from: "human", to, content });
    await pollAgentData();
  }, [pollAgentData]);

  const handleCreateTask = useCallback(async (title: string, description: string, assignee?: string, project?: string, dueDate?: string) => {
    await apiFetch("/tasks", "POST", { title, description, assignee: assignee || "unassigned", project, dueDate, createdBy: "human" });
    await pollAgentData();
  }, [pollAgentData]);

  const handleCreateProject = useCallback(async (name: string, description: string, color?: string) => {
    const project = await apiFetch<ProjectConfig>("/projects", "POST", { name, description, color, status: "draft" });
    await pollAgentData();
    // Auto-generate tasks if project has a description
    if (description.trim()) {
      await apiFetch("/projects/generate-tasks", "POST", { projectId: project.id });
      await pollAgentData();
    }
  }, [pollAgentData]);

  const handleUpdateProject = useCallback(async (id: string, patch: Partial<ProjectConfig>) => {
    await apiFetch("/projects", "PATCH", { id, ...patch });
    await pollAgentData();
  }, [pollAgentData]);

  const handleDeleteProject = useCallback(async (id: string) => {
    // Delete all tasks associated with this project first
    const projectTasks = sharedTasks.filter((t) => t.project === id);
    await Promise.all(projectTasks.map((t) => apiFetch(`/tasks?id=${t.id}`, "DELETE")));
    // Then delete the project itself
    await apiFetch(`/projects?id=${id}`, "DELETE");
    await pollAgentData();
  }, [pollAgentData, sharedTasks]);

  const handleGenerateTasks = useCallback(async (projectId: string) => {
    await apiFetch("/projects/generate-tasks", "POST", { projectId });
    await pollAgentData();
  }, [pollAgentData]);

  const handleActivateProject = useCallback(async (id: string) => {
    // Reset phase to null so the orchestrator starts fresh with discovery
    await apiFetch("/projects", "PATCH", { id, status: "active", phase: null, phaseMetadata: null });
    await pollAgentData();
  }, [pollAgentData]);

  const handleUpdateTask = useCallback(async (id: string, patch: Partial<SharedTask>) => {
    await apiFetch("/tasks", "PATCH", { id, ...patch });
    await pollAgentData();
  }, [pollAgentData]);

  const handleDeleteTask = useCallback(async (id: string) => {
    await apiFetch(`/tasks?id=${id}`, "DELETE");
    await pollAgentData();
  }, [pollAgentData]);

  const handleSendChannelMessage = useCallback(async (channelId: string, content: string) => {
    await apiFetch("/channel-messages", "POST", { channelId, from: "human", content });
    await pollAgentData();
  }, [pollAgentData]);

  const handleDeleteChannelMessage = useCallback(async (messageId: string) => {
    await apiFetch(`/channel-messages?id=${messageId}`, "DELETE");
    await pollAgentData();
  }, [pollAgentData]);

  const handleCreateChannel = useCallback(async (name: string, description: string) => {
    await apiFetch("/channels", "POST", { name, description, createdBy: "human" });
    await pollAgentData();
  }, [pollAgentData]);

  // Convert agent activity to the ActivityItem format for the task board
  const activityForBoard = activity.map((a) => ({
    id: a.id,
    title: a.action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    detail: a.detail,
    time: new Date(a.timestamp).toLocaleTimeString(),
    tone: (a.agent === "claude" ? "violet" : a.agent === "codex" ? "emerald" : "sky") as "violet" | "sky" | "emerald" | "amber",
  }));

  // Merge activities: agent activity + original snapshot activity
  const mergedActivity = activityForBoard.length > 0 ? activityForBoard : data.activityFeed;

  const renderScreen = () => {
    switch (activeScreen) {
      case "task-board":
        return (
          <TaskBoard
            tasks={data.tasks}
            sharedTasks={sharedTasks}
            activity={mergedActivity}
            agents={agents}
            projects={projects}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
          />
        );
      case "channel": {
        const ch = channels.find((c) => c.id === selectedChannelId);
        if (!ch) return <div className="flex items-center justify-center h-full text-[13px]" style={{ color: "#5c5c66" }}>Select a channel from the sidebar</div>;
        return (
          <ChannelScreen
            channel={ch}
            channelMessages={channelMessages}
            agents={agents}
            onSend={handleSendChannelMessage}
            onDeleteMessage={handleDeleteChannelMessage}
          />
        );
      }
      case "calendar":
        return <CalendarScreen items={data.calendarItems} tasks={sharedTasks} projects={projects} />;
      case "projects":
        return <ProjectsScreen projects={projects} tasks={sharedTasks} docs={agentDocs} agents={agents} onCreateProject={handleCreateProject} onUpdateProject={handleUpdateProject} onDeleteProject={handleDeleteProject} onGenerateTasks={handleGenerateTasks} onActivateProject={handleActivateProject} />;
      case "memory":
        return <MemoryScreen entries={data.memoryEntries} />;
      case "docs":
        return <DocsScreen agentDocs={agentDocs} agents={agents} projects={projects} />;
      case "team":
        return (
          <TeamScreen
            agents={agents}
            metrics={metrics}
            onSpawnAgent={handleSpawnAgent}
            onSwitchProvider={handleSwitchProvider}
            onDeleteAgent={handleDeleteAgent}
          />
        );
      case "office":
        return <OfficeScreen seats={data.officeSeats} />;
      case "settings":
        return <SettingsScreen />;
      case "approvals":
        return <ApprovalsScreen />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <Sidebar active={activeScreen} onNavigate={(id) => { setActiveScreen(id); setSelectedChannelId(null); }} counts={counts} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        channels={channels} activeChannelId={selectedChannelId}
        channelUnreadCounts={channelUnreadCounts}
        onSelectChannel={(chId) => { setActiveScreen("channel"); setSelectedChannelId(chId); markChannelRead(chId); }} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 h-[52px] flex-shrink-0 border-b"
          style={{ borderColor: "var(--border-primary)", background: "var(--bg-primary)" }}>
          <div className="flex items-center gap-1.5 text-[13px]">
            <span style={{ color: "var(--text-muted)" }}>Mission Control</span>
            <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>›</span>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {activeScreen === "channel" && selectedChannelId
                ? `#${channels.find((c) => c.id === selectedChannelId)?.name || selectedChannelId}`
                : screenTitles[activeScreen]}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Search</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded ml-4 font-mono" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>⌘K</span>
            </div>

            {/* Refresh */}
            <button onClick={refresh} disabled={refreshing}
              className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)" }} title="Refresh">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "animate-spin" : ""}>
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>

            {/* Orchestrator Play/Pause — the main control */}
            <button
              onClick={toggleOrchestrator}
              disabled={orchestratorStarting}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border-0 transition-all duration-200"
              style={{
                background: orchestratorRunning
                  ? "rgba(34, 197, 94, 0.12)"
                  : "var(--accent-violet)",
                color: orchestratorRunning ? "#4ade80" : "#fff",
                border: orchestratorRunning ? "1px solid rgba(34, 197, 94, 0.25)" : "1px solid transparent",
              }}
              title={orchestratorRunning ? "Stop orchestrator" : "Start orchestrator"}
            >
              {orchestratorStarting ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
              ) : orchestratorRunning ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                  Running
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start
                </>
              )}
            </button>

            {/* Agent count */}
            {orchestratorRunning && agents.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: "rgba(139, 92, 246, 0.06)", border: "1px solid rgba(139, 92, 246, 0.1)" }}>
                <span className="text-[11px] font-medium" style={{ color: "#a78bfa" }}>
                  {agents.filter((a) => a.status === "working").length} working
                </span>
              </div>
            )}

            {/* Status */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{
                background: orchestratorRunning ? "rgba(34, 197, 94, 0.06)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${orchestratorRunning ? "rgba(34, 197, 94, 0.1)" : "var(--border-primary)"}`,
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{
                background: orchestratorRunning ? "var(--accent-green)" : "var(--text-muted)",
                animation: orchestratorRunning ? "pulse-dot 2s ease-in-out infinite" : "none",
              }} />
              <span className="text-[11px] font-medium" style={{ color: orchestratorRunning ? "#4ade80" : "var(--text-muted)" }}>
                {orchestratorRunning ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          {renderScreen()}
        </main>
      </div>
    </div>
  );
}
