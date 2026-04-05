"use client";

import { useState } from "react";
import { builtinRoles, type AgentProvider } from "@/lib/mission-control-data";

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

const REASONING_EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Min" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
];

const SANDBOX_MODES: { value: SandboxMode; label: string; description: string }[] = [
  { value: "danger-full-access", label: "Full Access", description: "Unrestricted — matches Claude's permissions" },
  { value: "workspace-write", label: "Workspace Write", description: "Can only write within the project directory" },
  { value: "read-only", label: "Read Only", description: "Cannot modify any files" },
];

type Props = {
  onClose: () => void;
  onSpawn: (data: {
    name: string;
    provider: AgentProvider;
    model: string;
    role: string;
    roleFile: string;
    instructions: string;
    reasoningEffort?: ReasoningEffort;
    sandbox?: SandboxMode;
  }) => void;
};

export function SpawnAgentModal({ onClose, onSpawn }: Props) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("claude");
  const [model, setModel] = useState("");
  const [role, setRole] = useState("engineer");
  const [instructions, setInstructions] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
  const [sandbox, setSandbox] = useState<SandboxMode>("danger-full-access");

  const selectedRole = builtinRoles.find((r) => r.id === role);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSpawn({
      name: name.trim(),
      provider,
      model,
      role,
      roleFile: selectedRole?.instructionsFile || "",
      instructions,
      ...(provider === "codex" ? { reasoningEffort, sandbox } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[85vh] overflow-y-auto rounded-2xl p-6 animate-fade-in"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-primary)" }}>
          Spawn New Agent
        </h2>
        <p className="text-[12px] mb-5" style={{ color: "var(--text-muted)" }}>
          Create a new AI agent with custom role and instructions. A .md memory file will be created and tracked in git.
        </p>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
            Agent Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Charlie, Ralph..."
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
          />
        </div>

        {/* Provider + Model row */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
              Provider
            </label>
            <div className="flex gap-2">
              {(["claude", "codex"] as AgentProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium cursor-pointer border-0 transition-colors capitalize"
                  style={{
                    background: provider === p
                      ? p === "claude" ? "rgba(139, 92, 246, 0.15)" : "rgba(34, 197, 94, 0.15)"
                      : "var(--bg-primary)",
                    color: provider === p
                      ? p === "claude" ? "#a78bfa" : "#4ade80"
                      : "var(--text-muted)",
                    border: `1px solid ${provider === p
                      ? p === "claude" ? "rgba(139, 92, 246, 0.3)" : "rgba(34, 197, 94, 0.3)"
                      : "var(--border-primary)"}`,
                  }}
                >
                  {p === "claude" ? "Claude" : "Codex"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
              Model (optional)
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === "claude" ? "claude-opus-4-6" : "gpt-5.4"}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
            />
          </div>
        </div>

        {/* Role */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
            Role
          </label>
          <div className="flex flex-wrap gap-1.5">
            {builtinRoles.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0 transition-colors"
                style={{
                  background: role === r.id ? "var(--bg-tertiary)" : "var(--bg-primary)",
                  color: role === r.id ? "var(--text-primary)" : "var(--text-muted)",
                  border: `1px solid ${role === r.id ? "var(--accent-violet)" : "var(--border-primary)"}`,
                }}
              >
                {r.name}
              </button>
            ))}
          </div>
          {selectedRole && (
            <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
              {selectedRole.description} — instructions from <code className="text-[10px]" style={{ color: "var(--accent-violet)" }}>{selectedRole.instructionsFile}</code>
            </p>
          )}
        </div>

        {/* Codex-specific: Reasoning Effort + Sandbox */}
        {provider === "codex" && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4ade80" }}>Codex Settings</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[11px] w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Reasoning</span>
              <div className="flex gap-1 flex-1">
                {REASONING_EFFORTS.map((re) => (
                  <button
                    key={re.value}
                    onClick={() => setReasoningEffort(re.value)}
                    className="flex-1 px-1.5 py-1 rounded text-[10px] cursor-pointer border-0 transition-colors"
                    style={{
                      background: reasoningEffort === re.value ? "rgba(34, 197, 94, 0.15)" : "transparent",
                      color: reasoningEffort === re.value ? "#4ade80" : "var(--text-muted)",
                      border: `1px solid ${reasoningEffort === re.value ? "rgba(34, 197, 94, 0.3)" : "var(--border-primary)"}`,
                    }}
                  >
                    {re.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Sandbox</span>
              <div className="flex gap-1 flex-1">
                {SANDBOX_MODES.map((sm) => (
                  <button
                    key={sm.value}
                    onClick={() => setSandbox(sm.value)}
                    title={sm.description}
                    className="flex-1 px-1.5 py-1 rounded text-[10px] cursor-pointer border-0 transition-colors"
                    style={{
                      background: sandbox === sm.value ? "rgba(34, 197, 94, 0.15)" : "transparent",
                      color: sandbox === sm.value ? "#4ade80" : "var(--text-muted)",
                      border: `1px solid ${sandbox === sm.value ? "rgba(34, 197, 94, 0.3)" : "var(--border-primary)"}`,
                    }}
                  >
                    {sm.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Custom Instructions */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
            Custom Instructions (optional)
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Add custom instructions, context, or personality traits..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg text-[12px] outline-none resize-none"
            style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] cursor-pointer border-0"
            style={{ background: "var(--bg-primary)", color: "var(--text-muted)", border: "1px solid var(--border-primary)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer border-0"
            style={{
              background: name.trim() ? "var(--accent-violet)" : "var(--bg-tertiary)",
              color: name.trim() ? "#fff" : "var(--text-muted)",
            }}
          >
            Spawn Agent
          </button>
        </div>
      </div>
    </div>
  );
}
