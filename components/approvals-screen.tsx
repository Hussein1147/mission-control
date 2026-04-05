"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentConfig } from "@/lib/mission-control-data";

const SANDBOX_MODES = [
  { value: "danger-full-access", label: "Full Access", desc: "Unrestricted filesystem access" },
  { value: "workspace-write", label: "Workspace Write", desc: "Write only within project directory" },
  { value: "read-only", label: "Read Only", desc: "Cannot modify any files" },
] as const;

export function ApprovalsScreen() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});
  }, []);

  const updateAgent = useCallback(async (id: string, patch: Partial<AgentConfig>) => {
    const res = await fetch("/api/agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAgents((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setSaved(id);
      setTimeout(() => setSaved(null), 1500);
    }
  }, []);

  return (
    <div className="p-6 max-w-2xl mx-auto overflow-y-auto h-full animate-fade-in">
      <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Approvals</h2>
      <p className="text-[13px] mb-6" style={{ color: "var(--text-muted)" }}>
        Manage directory access and sandbox permissions for each agent.
      </p>

      {agents.map((agent) => (
        <AgentPermissionCard
          key={agent.id}
          agent={agent}
          onUpdate={updateAgent}
          justSaved={saved === agent.id}
        />
      ))}

      {agents.length === 0 && (
        <p className="text-[13px] py-12 text-center" style={{ color: "var(--text-muted)" }}>
          No agents registered yet
        </p>
      )}
    </div>
  );
}

function AgentPermissionCard({
  agent,
  onUpdate,
  justSaved,
}: {
  agent: AgentConfig;
  onUpdate: (id: string, patch: Partial<AgentConfig>) => void;
  justSaved: boolean;
}) {
  const [newDir, setNewDir] = useState("");
  const dirs = agent.allowedDirectories || [];
  const isCodex = agent.provider === "codex";

  const addDir = () => {
    const trimmed = newDir.trim();
    if (!trimmed || dirs.includes(trimmed)) return;
    onUpdate(agent.id, { allowedDirectories: [...dirs, trimmed] });
    setNewDir("");
  };

  const removeDir = (idx: number) => {
    onUpdate(agent.id, { allowedDirectories: dirs.filter((_, i) => i !== idx) });
  };

  return (
    <section className="mb-5">
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold"
            style={{
              background: isCodex ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)",
              color: isCodex ? "#4ade80" : "#c4b5fd",
            }}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
              {agent.name}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {agent.role}
            </div>
          </div>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
            style={{
              background: isCodex ? "rgba(34,197,94,0.1)" : "rgba(139,92,246,0.1)",
              color: isCodex ? "#4ade80" : "#a78bfa",
            }}
          >
            {agent.provider}
          </span>
          {justSaved && (
            <span className="text-[10px] font-medium" style={{ color: "#4ade80" }}>Saved</span>
          )}
        </div>

        {/* Sandbox mode (Codex only) */}
        {isCodex && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
              Sandbox Mode
            </div>
            <div className="flex gap-1.5">
              {SANDBOX_MODES.map((sm) => (
                <button
                  key={sm.value}
                  onClick={() => onUpdate(agent.id, { sandbox: sm.value as AgentConfig["sandbox"] })}
                  title={sm.desc}
                  className="flex-1 px-2 py-1.5 rounded-lg text-[11px] cursor-pointer border-0 transition-colors"
                  style={{
                    background: agent.sandbox === sm.value ? "rgba(34,197,94,0.15)" : "var(--bg-primary)",
                    color: agent.sandbox === sm.value ? "#4ade80" : "var(--text-muted)",
                    border: `1px solid ${agent.sandbox === sm.value ? "rgba(34,197,94,0.3)" : "var(--border-primary)"}`,
                  }}
                >
                  {sm.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
              {SANDBOX_MODES.find((s) => s.value === agent.sandbox)?.desc || "Not set — defaults to full access"}
            </p>
          </div>
        )}

        {/* Allowed directories */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
            Allowed Directories
          </div>
          <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
            Working directory is always mission-control. Add extra directories agents need access to.
          </p>

          {dirs.length > 0 && (
            <div className="flex flex-col gap-1 mb-2">
              {dirs.map((dir, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="text-[11px] font-mono flex-1 truncate" style={{ color: "var(--text-secondary)" }}>
                    {dir}
                  </span>
                  <button
                    onClick={() => removeDir(i)}
                    className="w-5 h-5 rounded flex items-center justify-center cursor-pointer border-0 flex-shrink-0"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addDir(); }}
              placeholder="/path/to/directory"
              className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono outline-none"
              style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
            />
            <button
              onClick={addDir}
              disabled={!newDir.trim()}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-0"
              style={{
                background: newDir.trim() ? "var(--accent-violet)" : "var(--bg-tertiary)",
                color: newDir.trim() ? "#fff" : "var(--text-muted)",
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
