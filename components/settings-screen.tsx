"use client";

import { useState, useEffect, useCallback } from "react";
import type { MissionControlSettings } from "@/lib/mission-control-data";

const DEFAULTS: MissionControlSettings = {
  autoPickup: false,
  deliberationMaxRounds: 99,
  deliberationTimeout: 60,
  spawnIdleTimeout: 30,
};

export function SettingsScreen() {
  const [settings, setSettings] = useState<MissionControlSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setSettings).catch(() => {});
  }, []);

  const save = useCallback(async (patch: Partial<MissionControlSettings>) => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const updated = await res.json();
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="p-6 max-w-2xl mx-auto overflow-y-auto h-full">
      <h2 className="text-lg font-semibold mb-6" style={{ color: "var(--text-primary)" }}>Settings</h2>

      {/* Project Automation */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
          Project Automation
        </h3>
        <div className="rounded-xl p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Auto-pickup projects</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Automatically activate new draft projects. The orchestrator will run discovery, generate tasks, and start execution without manual intervention.
              </div>
            </div>
            <button
              onClick={() => save({ autoPickup: !settings.autoPickup })}
              disabled={saving}
              className="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer border-0 flex-shrink-0 ml-4"
              style={{ background: settings.autoPickup ? "#8b5cf6" : "rgba(92,92,102,0.3)" }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-200"
                style={{
                  background: "#fff",
                  left: settings.autoPickup ? "calc(100% - 22px)" : "2px",
                }}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Deliberation Settings */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
          Deliberation
        </h3>
        <div className="rounded-xl p-4 space-y-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
          <SettingRow
            label="Max rounds"
            description="Maximum deliberation rounds before the orchestrator evaluates and decides. Set high to let agents debate freely."
            value={settings.deliberationMaxRounds}
            type="number"
            onChange={(v) => save({ deliberationMaxRounds: Number(v) })}
            saving={saving}
          />
          <SettingRow
            label="Phase timeout (minutes)"
            description="Maximum time a discovery or retrospective phase can run before the orchestrator escalates."
            value={settings.deliberationTimeout}
            type="number"
            onChange={(v) => save({ deliberationTimeout: Number(v) })}
            saving={saving}
          />
        </div>
      </section>

      {/* Agent Settings */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
          Agents
        </h3>
        <div className="rounded-xl p-4 space-y-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
          <SettingRow
            label="Idle timeout (minutes)"
            description="Kill an agent process if it produces no output for this many minutes. Prevents hung processes."
            value={settings.spawnIdleTimeout}
            type="number"
            onChange={(v) => save({ spawnIdleTimeout: Number(v) })}
            saving={saving}
          />
        </div>
      </section>

      {saved && (
        <div className="text-xs font-medium" style={{ color: "#4ade80" }}>
          Settings saved
        </div>
      )}

      {/* System Prompts (Role Files) */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
          System Prompts
        </h3>
        <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Click a role to view and edit its full system prompt.
        </div>
        <RoleEditor />
      </section>
    </div>
  );
}

type RoleFile = { id: string; filename: string; content: string };

function RoleEditor() {
  const [roles, setRoles] = useState<RoleFile[]>([]);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/roles").then((r) => r.json()).then((data: RoleFile[]) => {
      setRoles(data);
    }).catch(() => {});
  }, []);

  const openRole = (id: string) => {
    if (dirty && !confirm("You have unsaved changes. Discard?")) return;
    setActiveRole(id);
    const role = roles.find((r) => r.id === id);
    setEditContent(role?.content || "");
    setDirty(false);
    setSaved(false);
  };

  const closeRole = () => {
    if (dirty && !confirm("You have unsaved changes. Discard?")) return;
    setActiveRole(null);
    setDirty(false);
    setSaved(false);
  };

  const saveRole = async () => {
    if (!activeRole) return;
    setSaving(true);
    try {
      await fetch("/api/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeRole, content: editContent }),
      });
      setRoles((prev) => prev.map((r) => r.id === activeRole ? { ...r, content: editContent } : r));
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const roleLabels: Record<string, string> = {
    orchestrator: "Orchestrator",
    engineer: "Engineer",
    qa: "QA Engineer",
    architect: "Architect",
    researcher: "Researcher",
    ops: "Operations",
    comms: "Communications",
  };

  const lineCount = (content: string) => content.split("\n").length;

  return (
    <>
      {/* Role cards grid */}
      <div className="grid grid-cols-2 gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => openRole(r.id)}
            className="rounded-xl p-3 text-left cursor-pointer border-0 transition-colors"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          >
            <div className="text-[13px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>
              {roleLabels[r.id] || r.id}
            </div>
            <div className="text-[11px] font-mono truncate" style={{ color: "var(--text-muted)" }}>
              {r.content.split("\n").slice(0, 2).join(" ").slice(0, 80)}...
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
              {lineCount(r.content)} lines
            </div>
          </button>
        ))}
      </div>

      {/* Expanded prompt overlay */}
      {activeRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div
            className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              width: "min(720px, 90vw)",
              height: "min(80vh, 800px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-3">
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {roleLabels[activeRole] || activeRole}
                </h3>
                <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  roles/{activeRole}.md
                </span>
              </div>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-[11px]" style={{ color: "#8b5cf6" }}>Unsaved</span>}
                {saved && <span className="text-[11px]" style={{ color: "#4ade80" }}>Saved</span>}
                <button
                  onClick={saveRole}
                  disabled={!dirty || saving}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0 transition-colors"
                  style={{
                    background: dirty ? "#8b5cf6" : "rgba(92,92,102,0.2)",
                    color: dirty ? "#fff" : "var(--text-muted)",
                    opacity: !dirty || saving ? 0.5 : 1,
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={closeRole}
                  className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0 transition-colors text-[16px]"
                  style={{ background: "transparent", color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Editor textarea — scrolls */}
            <textarea
              value={editContent}
              onChange={(e) => { setEditContent(e.target.value); setDirty(true); setSaved(false); }}
              className="flex-1 w-full p-5 text-[13px] leading-relaxed font-mono resize-none border-0 outline-none"
              style={{
                background: "var(--bg-primary)",
                color: "var(--text-secondary)",
              }}
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>
      )}
    </>
  );
}

function SettingRow({
  label,
  description,
  value,
  type,
  onChange,
  saving,
}: {
  label: string;
  description: string;
  value: number | string;
  type: "number" | "text";
  onChange: (v: string) => void;
  saving: boolean;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{description}</div>
      </div>
      <input
        type={type}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== String(value)) onChange(localValue);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && localValue !== String(value)) onChange(localValue);
        }}
        disabled={saving}
        className="w-20 px-2 py-1.5 rounded-lg text-sm text-right border-0 flex-shrink-0"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
      />
    </div>
  );
}
