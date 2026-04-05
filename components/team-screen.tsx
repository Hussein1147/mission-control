"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentConfig, AgentProvider, AgentMetrics, AgentPoolConfig } from "@/lib/mission-control-data";
import { missionStatement, builtinRoles } from "@/lib/mission-control-data";
import { SpawnAgentModal } from "@/components/spawn-agent-modal";
import { AgentDashboard } from "@/components/agent-dashboard";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "working" ? "var(--accent-green)" :
    status === "active" || status === "idle" ? "var(--accent-sky)" :
    "var(--accent-amber)";
  return <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />;
}

function ProviderBadge({ provider }: { provider: string }) {
  const isC = provider === "claude";
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{
        background: isC ? "rgba(139, 92, 246, 0.12)" : "rgba(34, 197, 94, 0.12)",
        color: isC ? "#a78bfa" : "#4ade80",
      }}
    >
      {isC ? "Claude" : "Codex"}
    </span>
  );
}

function Avatar({ name, provider }: { name: string; provider: string }) {
  const isC = provider === "claude";
  const bg = isC ? "rgba(139, 92, 246, 0.2)" : "rgba(34, 197, 94, 0.2)";
  const color = isC ? "#c4b5fd" : "#86efac";
  return (
    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-base font-bold"
      style={{ background: bg, color }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function PoolSettings({ agents }: { agents: AgentConfig[] }) {
  const [config, setConfig] = useState<AgentPoolConfig | null>(() => ({
    enabled: false,
    maxAgents: 4,
    providers: {},
    scaleUpThreshold: 2,
    scaleDownAfterIdleMinutes: 10,
  } as AgentPoolConfig));
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/pool-config");
      if (res.ok) setConfig(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const save = async (updates: Partial<AgentPoolConfig>) => {
    if (!config) return;
    // Optimistic update to avoid uncontrolled→controlled flicker
    setConfig({ ...config, ...updates });
    setSaving(true);
    try {
      const res = await fetch("/api/pool-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) setConfig(await res.json());
    } finally {
      setSaving(false);
    }
  };

  if (!config) return null;

  const activeCount = agents.filter((a) => a.status !== "paused").length;
  const autoScaledCount = agents.filter((a) => a.autoScaled).length;
  const autoScaledActive = agents.filter((a) => a.autoScaled && a.status !== "paused").length;

  return (
    <div className="rounded-xl p-4 mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Pool Scaling
          </h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
            background: config.enabled ? "rgba(34, 197, 94, 0.12)" : "rgba(255, 255, 255, 0.06)",
            color: config.enabled ? "#4ade80" : "var(--text-muted)",
          }}>
            {config.enabled ? "Active" : "Disabled"}
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {activeCount}/{config.maxAgents} agents ({autoScaledActive} auto-scaled)
          </span>
          <input
            type="checkbox"
            checked={config.enabled ?? false}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="cursor-pointer"
          />
        </label>
      </div>
      {config.enabled && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--text-muted)" }}>Max Agents</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxAgents ?? 4}
              onChange={(e) => save({ maxAgents: parseInt(e.target.value) || 4 })}
              className="w-full px-2 py-1 rounded text-[12px] bg-transparent border outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--text-muted)" }}>Scale Up Threshold</label>
            <input
              type="number"
              min={1}
              max={20}
              value={config.scaleUpThreshold ?? 2}
              onChange={(e) => save({ scaleUpThreshold: parseInt(e.target.value) || 2 })}
              className="w-full px-2 py-1 rounded text-[12px] bg-transparent border outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--text-muted)" }}>Idle Timeout (min)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={config.scaleDownAfterIdleMinutes ?? 10}
              onChange={(e) => save({ scaleDownAfterIdleMinutes: parseInt(e.target.value) || 10 })}
              className="w-full px-2 py-1 rounded text-[12px] bg-transparent border outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "var(--text-primary)" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onSwitchProvider,
  onDelete,
}: {
  agent: AgentConfig;
  onSwitchProvider: (id: string, provider: AgentProvider) => void;
  onDelete: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const roleName = builtinRoles.find((r) => r.id === agent.role)?.name || agent.role;

  return (
    <div
      className="rounded-xl p-4 flex gap-4 items-start transition-colors duration-150 relative"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; setShowMenu(false); }}
    >
      <Avatar name={agent.name} provider={agent.provider} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</span>
          <StatusDot status={agent.status} />
          <ProviderBadge provider={agent.provider} />
          {agent.autoScaled && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium" style={{ background: "rgba(56, 189, 248, 0.12)", color: "#38bdf8" }}>
              Auto
            </span>
          )}
        </div>
        <p className="text-[12px] mb-1" style={{ color: "var(--accent-violet)" }}>{roleName}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {agent.status === "working" ? (agent.currentTaskTitle ? `Working on: ${agent.currentTaskTitle}` : "Working on a task...") : agent.lastActive ? `Last active: ${new Date(agent.lastActive).toLocaleTimeString()}` : "Ready"}
        </p>
        {agent.model && (
          <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
            {agent.model}
          </p>
        )}
      </div>

      {/* Options menu */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="absolute top-3 right-3 w-6 h-6 rounded flex items-center justify-center cursor-pointer border-0 bg-transparent"
        style={{ color: "var(--text-muted)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {showMenu && (
        <div
          className="absolute top-10 right-3 rounded-lg py-1 z-10 min-w-[160px]"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
        >
          <button
            onClick={() => {
              onSwitchProvider(agent.id, agent.provider === "claude" ? "codex" : "claude");
              setShowMenu(false);
            }}
            className="w-full px-3 py-2 text-left text-[12px] cursor-pointer border-0 bg-transparent transition-colors"
            style={{ color: "var(--text-primary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Switch to {agent.provider === "claude" ? "Codex" : "Claude"}
          </button>
          <button
            onClick={() => {
              onDelete(agent.id);
              setShowMenu(false);
            }}
            className="w-full px-3 py-2 text-left text-[12px] cursor-pointer border-0 bg-transparent transition-colors"
            style={{ color: "var(--accent-red)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Remove agent
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamScreen({
  agents,
  metrics,
  onSpawnAgent,
  onSwitchProvider,
  onDeleteAgent,
}: {
  agents: AgentConfig[];
  metrics: AgentMetrics[];
  onSpawnAgent: (data: { name: string; provider: AgentProvider; model: string; role: string; roleFile: string; instructions: string; reasoningEffort?: string; sandbox?: string }) => void;
  onSwitchProvider: (id: string, provider: AgentProvider) => void;
  onDeleteAgent: (id: string) => void;
}) {
  const [editingMission, setEditingMission] = useState(false);
  const [mission, setMission] = useState(missionStatement);
  const [showSpawnModal, setShowSpawnModal] = useState(false);

  return (
    <div className="p-6 overflow-y-auto h-full animate-fade-in">
      {/* Mission Statement */}
      <div className="rounded-xl p-5 mb-6" style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(56, 189, 248, 0.05))", border: "1px solid rgba(139, 92, 246, 0.15)" }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent-violet)" }}>
            Mission Statement
          </h3>
          <button onClick={() => setEditingMission(!editingMission)} className="text-[11px] cursor-pointer border-0 bg-transparent" style={{ color: "var(--text-muted)" }}>
            {editingMission ? "Done" : "Edit"}
          </button>
        </div>
        {editingMission ? (
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} className="w-full bg-transparent border-0 outline-none text-[14px] leading-relaxed resize-none" style={{ color: "var(--text-primary)" }} rows={2} />
        ) : (
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{mission}</p>
        )}
      </div>

      {/* Agent Utilization Dashboard */}
      <AgentDashboard agents={agents} metrics={metrics} />

      {/* Pool Scaling Settings */}
      <PoolSettings agents={agents} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Agents</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {agents.length} agents registered — spawn new ones or switch providers
          </p>
        </div>
        <button
          onClick={() => setShowSpawnModal(true)}
          className="px-4 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5 cursor-pointer border-0"
          style={{ background: "var(--accent-violet)", color: "#fff" }}
        >
          <span className="text-lg leading-none">+</span> Spawn Agent
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onSwitchProvider={onSwitchProvider}
            onDelete={onDeleteAgent}
          />
        ))}
      </div>

      {agents.length === 0 && (
        <div className="py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
          No agents configured. Spawn one to get started.
        </div>
      )}

      {showSpawnModal && (
        <SpawnAgentModal
          onClose={() => setShowSpawnModal(false)}
          onSpawn={(data) => {
            onSpawnAgent(data);
            setShowSpawnModal(false);
          }}
        />
      )}
    </div>
  );
}
