"use client";

import type { AgentConfig, AgentMetrics } from "@/lib/mission-control-data";
import { builtinRoles } from "@/lib/mission-control-data";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AgentDashboard({
  agents,
  metrics,
}: {
  agents: AgentConfig[];
  metrics: AgentMetrics[];
}) {
  const today = getToday();
  const todayMetrics = metrics.filter((m) => m.timestamp.startsWith(today));

  // Aggregate per agent
  const agentStats = agents.map((agent) => {
    const agentMetrics = todayMetrics.filter((m) => m.agentId === agent.id);
    const totalTokens = agentMetrics.reduce((sum, m) => sum + m.totalTokens, 0);
    const totalDuration = agentMetrics.reduce((sum, m) => sum + m.durationMs, 0);
    const tasksCompleted = agentMetrics.length;
    const avgDuration = tasksCompleted > 0 ? totalDuration / tasksCompleted : 0;

    return {
      agent,
      totalTokens,
      totalDuration,
      tasksCompleted,
      avgDuration,
    };
  });

  // Aggregate totals
  const totalTokensAll = agentStats.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalTasksAll = agentStats.reduce((sum, s) => sum + s.tasksCompleted, 0);
  const workingCount = agents.filter((a) => a.status === "working").length;
  const idleCount = agents.filter((a) => a.status === "idle" || a.status === "active").length;

  // Token distribution for bar chart
  const maxTokens = Math.max(...agentStats.map((s) => s.totalTokens), 1);

  // Per-provider aggregation
  const providerMap: Record<string, { tokens: number; tasks: number }> = {};
  for (const s of agentStats) {
    const p = s.agent.provider;
    if (!providerMap[p]) providerMap[p] = { tokens: 0, tasks: 0 };
    providerMap[p].tokens += s.totalTokens;
    providerMap[p].tasks += s.tasksCompleted;
  }

  return (
    <div className="rounded-xl p-5 mb-6" style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--accent-sky)" }}>
        Agent Utilization Dashboard
      </h3>

      {/* Summary stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatBox label="Working" value={String(workingCount)} tone="green" />
        <StatBox label="Idle" value={String(idleCount)} tone="amber" />
        <StatBox label="Tasks Today" value={String(totalTasksAll)} tone="violet" />
        <StatBox label="Tokens Today" value={formatTokens(totalTokensAll)} tone="sky" />
      </div>

      {/* Provider breakdown */}
      {Object.keys(providerMap).length > 0 && (
        <div className="flex gap-3 mb-5">
          {Object.entries(providerMap).map(([provider, data]) => (
            <div key={provider} className="flex-1 rounded-lg p-3" style={{ background: "var(--bg-secondary)" }}>
              <span className="text-[10px] font-medium uppercase tracking-wider block mb-1"
                style={{ color: provider === "claude" ? "#a78bfa" : "#4ade80" }}>
                {provider}
              </span>
              <span className="text-[16px] font-bold block" style={{ color: "var(--text-primary)" }}>
                {data.tasks} tasks
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {formatTokens(data.tokens)} tokens
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Per-agent breakdown */}
      <div className="space-y-2.5">
        {agentStats.map(({ agent, totalTokens, tasksCompleted, avgDuration }) => {
          const roleName = builtinRoles.find((r) => r.id === agent.role)?.name || agent.role;
          const barWidth = totalTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;
          const isWorking = agent.status === "working";

          return (
            <div key={agent.id} className="rounded-lg p-3" style={{ background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{
                    background: isWorking ? "var(--accent-green)" : "var(--accent-sky)",
                    animation: isWorking ? "pulse-dot 2s ease-in-out infinite" : "none",
                  }} />
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {agent.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: agent.provider === "claude" ? "rgba(139, 92, 246, 0.12)" : "rgba(34, 197, 94, 0.12)",
                      color: agent.provider === "claude" ? "#a78bfa" : "#4ade80",
                    }}>
                    {roleName}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>{tasksCompleted} tasks</span>
                  <span>{formatTokens(totalTokens)} tokens</span>
                  {avgDuration > 0 && <span>avg {formatDuration(avgDuration)}</span>}
                </div>
              </div>

              {/* Current task */}
              {isWorking && agent.currentTaskTitle && (
                <div className="mb-2 text-[11px] px-2 py-1 rounded" style={{ background: "rgba(34, 197, 94, 0.06)", color: "#4ade80" }}>
                  Working on: {agent.currentTaskTitle}
                  {agent.taskStartedAt && (
                    <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                      ({formatDuration(Date.now() - new Date(agent.taskStartedAt).getTime())} elapsed)
                    </span>
                  )}
                </div>
              )}

              {/* Token bar */}
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    background: agent.provider === "claude"
                      ? "linear-gradient(90deg, #8b5cf6, #a78bfa)"
                      : "linear-gradient(90deg, #22c55e, #4ade80)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {agentStats.length === 0 && (
        <p className="text-[12px] text-center py-4" style={{ color: "var(--text-muted)" }}>
          No agents registered yet.
        </p>
      )}
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    green: { bg: "rgba(34, 197, 94, 0.08)", text: "#4ade80" },
    amber: { bg: "rgba(245, 158, 11, 0.08)", text: "#fbbf24" },
    violet: { bg: "rgba(139, 92, 246, 0.08)", text: "#a78bfa" },
    sky: { bg: "rgba(56, 189, 248, 0.08)", text: "#38bdf8" },
  };
  const c = colors[tone] || colors.sky;

  return (
    <div className="rounded-lg p-3 text-center" style={{ background: c.bg }}>
      <span className="text-[18px] font-bold block" style={{ color: c.text }}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
