"use client";

import { useState, useEffect } from "react";
import type { MemoryEntry } from "@/lib/mission-control-data";

type SmartMemory = {
  id: string;
  content: string;
  memory_type: string;
  status: string;
  importance: number;
  confidence: number;
  created_at: string;
  updated_at: string;
  entities?: string[];
};

function ImportanceBadge({ value }: { value: number }) {
  const color = value >= 0.8 ? "#4ade80" : value >= 0.5 ? "#fbbf24" : "var(--text-muted)";
  return (
    <span className="text-[10px] font-mono" style={{ color }}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    episodic: { bg: "rgba(139, 92, 246, 0.12)", color: "#a78bfa" },
    semantic: { bg: "rgba(56, 189, 248, 0.12)", color: "#7dd3fc" },
    belief: { bg: "rgba(245, 158, 11, 0.12)", color: "#fbbf24" },
    goal: { bg: "rgba(34, 197, 94, 0.12)", color: "#4ade80" },
    preference: { bg: "rgba(236, 72, 153, 0.12)", color: "#f472b6" },
    identity: { bg: "rgba(139, 92, 246, 0.2)", color: "#c4b5fd" },
    task_state: { bg: "rgba(255, 255, 255, 0.06)", color: "var(--text-muted)" },
  };
  const s = colors[type] || colors.task_state;
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: s.bg, color: s.color }}>
      {type}
    </span>
  );
}

export function MemoryScreen({ entries }: { entries: MemoryEntry[] }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [smartMemories, setSmartMemories] = useState<SmartMemory[]>([]);
  const [smartAvailable, setSmartAvailable] = useState(false);
  const [source, setSource] = useState<"smart" | "local">("smart");

  useEffect(() => {
    async function loadSmartMemories() {
      try {
        const healthRes = await fetch("/api/smart-memory?action=health");
        const health = await healthRes.json();
        if (health.status === "ok") {
          setSmartAvailable(true);
          const memRes = await fetch("/api/smart-memory?action=memories");
          const mems = await memRes.json();
          if (Array.isArray(mems)) {
            setSmartMemories(mems);
          }
        }
      } catch {
        setSmartAvailable(false);
      }
    }
    loadSmartMemories();
    const interval = setInterval(loadSmartMemories, 10000);
    return () => clearInterval(interval);
  }, []);

  const activeSource = smartAvailable && source === "smart" ? "smart" : "local";

  const filteredSmart = smartMemories.filter((m) =>
    !search || m.content.toLowerCase().includes(search.toLowerCase()) ||
    m.memory_type.toLowerCase().includes(search.toLowerCase())
  );

  const filteredLocal = entries.filter((e) =>
    !search || e.title.toLowerCase().includes(search.toLowerCase()) ||
    e.summary.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 overflow-y-auto h-full animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Memory</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {smartAvailable
              ? `Smart Memory active — ${smartMemories.length} memories stored`
              : "Showing local memory files"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {smartAvailable && (
            <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-primary)" }}>
              {(["smart", "local"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className="px-3 py-1.5 text-[12px] cursor-pointer border-0 capitalize"
                  style={{
                    background: source === s ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                    color: source === s ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {s === "smart" ? "Smart Memory" : "Local Files"}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-64 px-3 py-2 rounded-lg text-[13px] outline-none border-0"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
          />
        </div>
      </div>

      {/* Smart Memory Status */}
      {smartAvailable && source === "smart" && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(34, 197, 94, 0.06)", border: "1px solid rgba(34, 197, 94, 0.1)" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent-green)" }} />
          <span className="text-[12px]" style={{ color: "#4ade80" }}>
            Smart Memory connected — transcript-first, revision-aware memory backend
          </span>
        </div>
      )}

      {/* Smart Memory entries */}
      {activeSource === "smart" && (
        <div className="flex flex-col gap-3">
          {filteredSmart.map((mem) => {
            const isExpanded = expanded === mem.id;
            return (
              <div
                key={mem.id}
                onClick={() => setExpanded(isExpanded ? null : mem.id)}
                className="rounded-xl p-4 cursor-pointer transition-all duration-150"
                style={{
                  background: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card)",
                  border: `1px solid ${isExpanded ? "var(--border-primary)" : "var(--border-subtle)"}`,
                }}
                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--bg-card)"; }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={mem.memory_type} />
                    <ImportanceBadge value={mem.importance} />
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: mem.status === "active" ? "rgba(34, 197, 94, 0.08)" : "rgba(255,255,255,0.04)",
                      color: mem.status === "active" ? "#4ade80" : "var(--text-muted)",
                    }}>
                      {mem.status}
                    </span>
                  </div>
                  <span className="text-[11px] flex-shrink-0 ml-4" style={{ color: "var(--text-muted)" }}>
                    {new Date(mem.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {isExpanded ? mem.content : (mem.content.length > 150 ? mem.content.slice(0, 150) + "..." : mem.content)}
                </p>
                {mem.entities && mem.entities.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {mem.entities.map((e) => (
                      <span key={e} className="px-2 py-0.5 rounded-full text-[10px]"
                        style={{ background: "rgba(139, 92, 246, 0.1)", color: "#a78bfa" }}>
                        {e}
                      </span>
                    ))}
                  </div>
                )}
                {isExpanded && (
                  <div className="mt-3 pt-3 flex items-center gap-4 text-[11px] animate-fade-in"
                    style={{ borderTop: "1px solid var(--border-primary)", color: "var(--text-muted)" }}>
                    <span>Confidence: {(mem.confidence * 100).toFixed(0)}%</span>
                    <span>Updated: {new Date(mem.updated_at).toLocaleString()}</span>
                    <span className="font-mono text-[10px]" style={{ opacity: 0.5 }}>ID: {mem.id}</span>
                  </div>
                )}
              </div>
            );
          })}
          {filteredSmart.length === 0 && (
            <div className="py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
              {search ? "No memories match your search" : "No memories stored yet — agents will build memory as they work"}
            </div>
          )}
        </div>
      )}

      {/* Local file entries (fallback) */}
      {activeSource === "local" && (
        <div className="flex flex-col gap-3">
          {filteredLocal.map((entry) => {
            const isExpanded = expanded === entry.id;
            return (
              <div
                key={entry.id}
                onClick={() => setExpanded(isExpanded ? null : entry.id)}
                className="rounded-xl p-4 cursor-pointer transition-all duration-150"
                style={{
                  background: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card)",
                  border: `1px solid ${isExpanded ? "var(--border-primary)" : "var(--border-subtle)"}`,
                }}
                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--bg-card)"; }}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{entry.title}</h3>
                  <span className="text-[11px] flex-shrink-0 ml-4" style={{ color: "var(--text-muted)" }}>{entry.date}</span>
                </div>
                <p className="text-[12px] leading-relaxed mb-2" style={{ color: "var(--text-secondary)" }}>
                  {entry.summary}
                </p>
                {entry.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-2">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-[10px]"
                        style={{ background: "rgba(139, 92, 246, 0.1)", color: "#a78bfa" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {isExpanded && entry.excerpt.length > 0 && (
                  <div className="mt-3 pt-3 animate-fade-in" style={{ borderTop: "1px solid var(--border-primary)" }}>
                    {entry.excerpt.map((line, i) => (
                      <p key={i} className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{line}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filteredLocal.length === 0 && (
            <div className="py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
              {search ? "No memories match your search" : "No local memories found"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
