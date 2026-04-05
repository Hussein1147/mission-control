"use client";

import { useState, useRef } from "react";
import type { ProjectConfig, SharedTask, DocEntry, AgentConfig, TaskAttachment } from "@/lib/mission-control-data";

const PROJECT_COLORS = ["#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#38bdf8", "#f472b6", "#a78bfa", "#4ade80"];

function ProgressBar({ value }: { value: number }) {
  const color = value >= 75 ? "var(--accent-green)" : value >= 40 ? "var(--accent-violet)" : "var(--accent-amber)";
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  todo: { bg: "rgba(92,92,102,0.15)", color: "#8b8b95" },
  in_progress: { bg: "rgba(139,92,246,0.15)", color: "#a78bfa" },
  review: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
  done: { bg: "rgba(34,197,94,0.12)", color: "#4ade80" },
};

export function ProjectsScreen({
  projects,
  tasks,
  docs,
  agents,
  onCreateProject,
  onUpdateProject,
  onGenerateTasks,
  onActivateProject,
  onDeleteProject,
}: {
  projects: ProjectConfig[];
  tasks: SharedTask[];
  docs: DocEntry[];
  agents: AgentConfig[];
  onCreateProject: (name: string, description: string, color?: string) => void;
  onUpdateProject?: (id: string, patch: Partial<ProjectConfig>) => void;
  onGenerateTasks?: (projectId: string) => Promise<void>;
  onActivateProject?: (id: string) => Promise<void>;
  onDeleteProject?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<ProjectConfig | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState("");
  const [detailTab, setDetailTab] = useState<"tasks" | "files">("tasks");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState(PROJECT_COLORS[0]);
  const [showAddPath, setShowAddPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getProjectTasks = (id: string) => tasks.filter((t) => t.project === id);
  const getProjectDocs = (id: string) => docs.filter((d) => d.project === id);

  // Get unique agents working on this project
  const getProjectTeam = (id: string) => {
    const assignees = new Set(getProjectTasks(id).map((t) => t.assignee).filter((a) => a !== "unassigned"));
    return agents.filter((a) => assignees.has(a.id));
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateProject(newName.trim(), newDesc.trim(), newColor);
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
  };

  return (
    <div className="p-6 overflow-y-auto h-full animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Projects</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {projects.length} project{projects.length !== 1 ? "s" : ""} — organize tasks and docs
          </p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5 cursor-pointer border-0"
          style={{ background: "var(--accent-violet)", color: "#fff" }}>
          <span className="text-lg leading-none">+</span> New Project
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl p-4 mb-4 animate-fade-in" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name..." autoFocus
            className="w-full mb-2 px-3 py-2 rounded-lg text-[13px] outline-none border-0"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }} />
          <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description..." rows={2}
            className="w-full mb-3 px-3 py-2 rounded-lg text-[12px] outline-none border-0 resize-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }} />
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Color:</span>
            {PROJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)}
                className="w-6 h-6 rounded-full cursor-pointer border-2"
                style={{ background: c, borderColor: newColor === c ? "#fff" : "transparent" }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0"
              style={{ background: "var(--accent-violet)", color: "#fff" }}>Create</button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0"
              style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Project detail view */}
      {selected ? (() => {
        const pt = getProjectTasks(selected.id);
        const pd = getProjectDocs(selected.id);
        const team = getProjectTeam(selected.id);
        const done = pt.filter((t) => t.status === "done").length;
        const blocked = pt.filter((t) => t.blocked).length;
        const inProgress = pt.filter((t) => t.status === "in_progress").length;
        const progress = pt.length > 0 ? Math.round((done / pt.length) * 100) : 0;

        return (
          <div className="animate-fade-in max-w-4xl">
            <button onClick={() => { setSelected(null); setEditing(false); setShowAddPath(false); }}
              className="flex items-center gap-1.5 text-[13px] mb-5 cursor-pointer border-0 bg-transparent"
              style={{ color: "var(--accent-violet)" }}>
              ← Back to projects
            </button>

            {/* Header card */}
            <div className="rounded-xl p-6 mb-6" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
              {editing ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    {PROJECT_COLORS.map((c) => (
                      <button key={c} onClick={() => setEditColor(c)}
                        className="w-5 h-5 rounded-full cursor-pointer border-2"
                        style={{ background: c, borderColor: editColor === c ? "#fff" : "transparent" }} />
                    ))}
                  </div>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-full mb-2 px-3 py-2 rounded-lg text-[16px] font-bold outline-none border-0"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }} />
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3}
                    className="w-full mb-3 px-3 py-2 rounded-lg text-[13px] outline-none border-0 resize-none leading-relaxed"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }} />
                  <div className="flex gap-2">
                    <button onClick={() => {
                      onUpdateProject?.(selected.id, { name: editName, description: editDesc, color: editColor });
                      setSelected({ ...selected, name: editName, description: editDesc, color: editColor });
                      setEditing(false);
                    }} className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0"
                      style={{ background: "var(--accent-violet)", color: "#fff" }}>Save</button>
                    <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: selected.color }} />
                      <h3 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{selected.name}</h3>
                      {/* Status badge */}
                      {(() => {
                        const s = selected.status || "draft";
                        const styles: Record<string, { bg: string; color: string }> = {
                          draft: { bg: "rgba(92,92,102,0.15)", color: "#8b8b95" },
                          active: { bg: "rgba(34,197,94,0.12)", color: "#4ade80" },
                          paused: { bg: "rgba(245,158,11,0.12)", color: "#fbbf24" },
                          completed: { bg: "rgba(139,92,246,0.12)", color: "#a78bfa" },
                        };
                        const st = styles[s] || styles.draft;
                        return (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                            style={{ background: st.bg, color: st.color }}>{s}</span>
                        );
                      })()}
                      {/* Phase badge for active projects */}
                      {selected.status === "active" && selected.phase && selected.phase !== "completed" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                          style={{
                            background: selected.phase === "discovery" ? "rgba(59,130,246,0.12)" : selected.phase === "retrospective" ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)",
                            color: selected.phase === "discovery" ? "#60a5fa" : selected.phase === "retrospective" ? "#fbbf24" : "#4ade80",
                          }}>
                          {selected.phase}{selected.phaseMetadata?.waitingForHuman ? " ⏸" : ""}
                        </span>
                      )}
                      {selected.phaseMetadata?.waitingForHuman && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                          Needs your input
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Activate / Pause button (icon only) */}
                      {(selected.status || "draft") === "draft" && onActivateProject && (
                        <button onClick={async () => { await onActivateProject(selected.id); setSelected({ ...selected, status: "active" }); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
                          style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}
                          title="Activate project">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        </button>
                      )}
                      {selected.status === "active" && onUpdateProject && (
                        <button onClick={() => { onUpdateProject(selected.id, { status: "paused" }); setSelected({ ...selected, status: "paused" }); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}
                          title="Pause project">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                        </button>
                      )}
                      {selected.status === "paused" && onActivateProject && (
                        <button onClick={async () => { await onActivateProject(selected.id); setSelected({ ...selected, status: "active" }); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
                          style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}
                          title="Resume project">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        </button>
                      )}
                      {selected.status === "completed" && onUpdateProject && (
                        <button onClick={() => { onUpdateProject(selected.id, { status: "archived" }); setSelected({ ...selected, status: "archived" }); }}
                          className="h-8 rounded-lg flex items-center gap-1.5 px-3 cursor-pointer border-0 text-[11px] font-medium"
                          style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}
                          title="Archive project">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
                          </svg>
                          Archive
                        </button>
                      )}
                      {selected.status === "archived" && onUpdateProject && (
                        <button onClick={() => { onUpdateProject(selected.id, { status: "completed" }); setSelected({ ...selected, status: "completed" }); }}
                          className="h-8 rounded-lg flex items-center gap-1.5 px-3 cursor-pointer border-0 text-[11px] font-medium"
                          style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}
                          title="Unarchive project">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
                          </svg>
                          Unarchive
                        </button>
                      )}
                      {/* Generate/regenerate tasks button — hidden only when active AND in discovery/retrospective (orchestrator handles it) */}
                      {(selected.status || "draft") !== "completed" && selected.status !== "archived" && !(selected.status === "active" && selected.phase?.match(/^(discovery|retrospective)$/)) && onGenerateTasks && !generating && (
                        <button onClick={async () => { setGenerating(true); onGenerateTasks(selected.id).finally(() => setGenerating(false)); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0 transition-colors"
                          style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}
                          title="Generate tasks">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                          </svg>
                        </button>
                      )}
                      {generating && (
                        <div className="relative h-8 rounded-lg flex items-center gap-1.5 px-3 overflow-hidden"
                          style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>
                          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#a78bfa" }} />
                          <span className="text-[11px] font-medium whitespace-nowrap">Generating</span>
                          <div className="absolute bottom-0 left-0 h-[2px] rounded-full animate-slide-progress"
                            style={{ background: "#a78bfa", width: "100%" }} />
                        </div>
                      )}
                      {/* Edit button */}
                      {onUpdateProject && (
                        <button onClick={() => { setEditName(selected.name); setEditDesc(selected.description); setEditColor(selected.color); setEditing(true); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
                          style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                      )}
                      {/* Delete button */}
                      {onDeleteProject && (
                        <button onClick={() => { if (confirm(`Delete project "${selected.name}"? Tasks won't be deleted.`)) { onDeleteProject(selected.id); setSelected(null); } }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-0"
                          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  {selected.description && (
                    <p className="text-[13px] leading-relaxed mb-5" style={{ color: "var(--text-secondary)" }}>
                      {selected.description}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-6 mb-4">
                    {[
                      { v: pt.length, l: "Tasks", c: "var(--accent-violet)" },
                      { v: inProgress, l: "Active", c: "#a78bfa" },
                      ...(blocked > 0 ? [{ v: blocked, l: "Blocked", c: "#ef4444" }] : []),
                      { v: done, l: "Done", c: "var(--accent-green)" },
                      { v: selected.attachments?.length || 0, l: "Files", c: "#38bdf8" },
                    ].map((s) => (
                      <div key={s.l} className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold" style={{ color: s.c }}>{s.v}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.l}</span>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="mb-5">
                    <div className="flex justify-between mb-1">
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Progress</span>
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{progress}%</span>
                    </div>
                    <ProgressBar value={progress} />
                  </div>

                  {/* Team */}
                  {team.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Team</span>
                      <div className="flex items-center gap-2 mt-2">
                        {team.map((a) => {
                          const isClaude = a.provider === "claude";
                          const color = isClaude ? "#a78bfa" : "#4ade80";
                          const bg = isClaude ? "rgba(139,92,246,0.15)" : "rgba(34,197,94,0.15)";
                          return (
                            <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-subtle)" }}>
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                                style={{ background: bg, color }}>{a.name.charAt(0)}</span>
                              <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{a.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-muted)" }}>{a.role}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {team.length === 0 && (
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No agents assigned to tasks in this project yet</p>
                  )}
                </>
              )}
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 mb-4">
              {(["tasks", "files"] as const).map((tab) => (
                <button key={tab} onClick={() => setDetailTab(tab)}
                  className="px-4 py-2 rounded-lg text-[12px] font-semibold cursor-pointer border-0 uppercase tracking-wider"
                  style={{
                    background: detailTab === tab ? "rgba(139,92,246,0.1)" : "transparent",
                    color: detailTab === tab ? "#ececef" : "var(--text-muted)",
                    borderBottom: detailTab === tab ? "2px solid var(--accent-violet)" : "2px solid transparent",
                  }}>
                  {tab} ({tab === "tasks" ? pt.length : (selected.attachments?.length || 0)})
                </button>
              ))}
            </div>

            {/* Tasks tab */}
            {detailTab === "tasks" && (
              <div className="flex flex-col gap-2">
                {pt.map((t) => {
                  const sc = STATUS_COLORS[t.status] || STATUS_COLORS.todo;
                  const assigneeAgent = agents.find((a) => a.id === t.assignee);
                  return (
                    <div key={t.id} className="rounded-lg px-4 py-3 flex items-center gap-3"
                      style={{ background: "var(--bg-card)", border: `1px solid ${t.blocked ? "rgba(239,68,68,0.2)" : "var(--border-subtle)"}` }}>
                      {t.blocked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                      )}
                      <span className="flex-1 text-[13px]" style={{ color: t.blocked ? "#8b8b95" : "var(--text-primary)" }}>{t.title}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {assigneeAgent && (
                          <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                              style={{
                                background: assigneeAgent.provider === "claude" ? "rgba(139,92,246,0.15)" : "rgba(34,197,94,0.15)",
                                color: assigneeAgent.provider === "claude" ? "#a78bfa" : "#4ade80",
                              }}>{assigneeAgent.name.charAt(0)}</span>
                            {assigneeAgent.name}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: sc.bg, color: sc.color }}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {pt.length === 0 && (
                  <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>No tasks in this project yet</p>
                )}
              </div>
            )}

            {/* Files tab */}
            {detailTab === "files" && (
              <div>
                {/* Add file actions */}
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0 flex items-center gap-1.5"
                    style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    {uploading ? "Uploading..." : "Upload file"}
                  </button>
                  <button onClick={() => setShowAddPath(!showAddPath)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0 flex items-center gap-1.5"
                    style={{ background: "rgba(56,189,248,0.1)", color: "#7dd3fc" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
                    </svg>
                    Add file path
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const form = new FormData();
                      form.append("file", file);
                      const res = await fetch("/api/uploads", { method: "POST", body: form });
                      const attachment: TaskAttachment = await res.json();
                      const updated = [...(selected.attachments || []), attachment];
                      onUpdateProject?.(selected.id, { attachments: updated });
                      setSelected({ ...selected, attachments: updated });
                    } finally {
                      setUploading(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }} />
                </div>

                {showAddPath && (
                  <div className="flex gap-2 mb-4">
                    <input type="text" value={pathInput} onChange={(e) => setPathInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && pathInput.trim()) {
                          const attachment: TaskAttachment = {
                            id: Date.now().toString(36),
                            name: pathInput.trim().split("/").pop() || pathInput.trim(),
                            type: "path",
                            path: pathInput.trim(),
                            addedBy: "human",
                            addedAt: new Date().toISOString(),
                          };
                          const updated = [...(selected.attachments || []), attachment];
                          onUpdateProject?.(selected.id, { attachments: updated });
                          setSelected({ ...selected, attachments: updated });
                          setPathInput("");
                          setShowAddPath(false);
                        }
                      }}
                      placeholder="/path/to/file..." autoFocus
                      className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none border-0 font-mono"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }} />
                    <button onClick={() => {
                      if (!pathInput.trim()) return;
                      const attachment: TaskAttachment = {
                        id: Date.now().toString(36),
                        name: pathInput.trim().split("/").pop() || pathInput.trim(),
                        type: "path",
                        path: pathInput.trim(),
                        addedBy: "human",
                        addedAt: new Date().toISOString(),
                      };
                      const updated = [...(selected.attachments || []), attachment];
                      onUpdateProject?.(selected.id, { attachments: updated });
                      setSelected({ ...selected, attachments: updated });
                      setPathInput("");
                      setShowAddPath(false);
                    }} className="px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-0"
                      style={{ background: "var(--accent-violet)", color: "#fff" }}>Add</button>
                  </div>
                )}

                {/* File list */}
                <div className="flex flex-col gap-2">
                  {(selected.attachments || []).map((a) => (
                    <div key={a.id} className="rounded-lg px-4 py-3 flex items-center gap-3"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium block truncate" style={{ color: "var(--text-primary)" }}>{a.name}</span>
                        <span className="text-[11px] font-mono truncate block" style={{ color: "var(--text-muted)" }}>{a.path}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                        style={{ background: a.type === "file" ? "rgba(139,92,246,0.15)" : "rgba(56,189,248,0.15)", color: a.type === "file" ? "#a78bfa" : "#7dd3fc" }}>
                        {a.type === "file" ? "uploaded" : "local path"}
                      </span>
                      {a.size && <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>{(a.size / 1024).toFixed(1)}KB</span>}
                      <button onClick={() => {
                        const updated = (selected.attachments || []).filter((x) => x.id !== a.id);
                        onUpdateProject?.(selected.id, { attachments: updated });
                        setSelected({ ...selected, attachments: updated });
                      }}
                        className="w-6 h-6 rounded flex items-center justify-center cursor-pointer border-0 flex-shrink-0"
                        style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {(!selected.attachments || selected.attachments.length === 0) && (
                    <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
                      No files attached — upload files or add local paths for agents to reference
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })() : (<>
        <div className="flex items-center justify-end mb-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Show archived</span>
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-8 h-4 rounded-full relative cursor-pointer border-0 transition-colors"
              style={{ background: showArchived ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.1)" }}
            >
              <span className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                style={{ background: showArchived ? "#a78bfa" : "var(--text-muted)", left: showArchived ? "17px" : "2px" }} />
            </button>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {projects.filter((p) => showArchived || p.status !== "archived").map((p) => {
            const pt = getProjectTasks(p.id);
            const pd = getProjectDocs(p.id);
            const team = getProjectTeam(p.id);
            const done = pt.filter((t) => t.status === "done").length;
            const progress = pt.length > 0 ? Math.round((done / pt.length) * 100) : 0;
            return (
              <div key={p.id} onClick={() => { setSelected(p); setDetailTab("tasks"); setShowAddPath(false); }}
                className="rounded-xl p-5 cursor-pointer transition-all duration-150"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", opacity: p.status === "archived" ? 0.5 : 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                  <h3 className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{p.name}</h3>
                  {(() => {
                    const s = p.status || "draft";
                    const st = s === "active" ? { bg: "rgba(34,197,94,0.12)", color: "#4ade80" }
                      : s === "paused" ? { bg: "rgba(245,158,11,0.12)", color: "#fbbf24" }
                      : s === "completed" ? { bg: "rgba(139,92,246,0.12)", color: "#a78bfa" }
                      : s === "archived" ? { bg: "rgba(92,92,102,0.1)", color: "#6b6b75" }
                      : { bg: "rgba(92,92,102,0.15)", color: "#8b8b95" };
                    return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ml-auto" style={{ background: st.bg, color: st.color }}>{s}</span>;
                  })()}
                </div>
                <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-muted)" }}>
                  {p.description.length > 100 ? p.description.slice(0, 100) + "..." : p.description}
                </p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{pt.length} tasks, {p.attachments?.length || 0} files</span>
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{progress}%</span>
                </div>
                <ProgressBar value={progress} />
                {team.length > 0 && (
                  <div className="flex items-center gap-1 mt-3">
                    {team.slice(0, 4).map((a) => (
                      <span key={a.id} className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{
                          background: a.provider === "claude" ? "rgba(139,92,246,0.15)" : "rgba(34,197,94,0.15)",
                          color: a.provider === "claude" ? "#a78bfa" : "#4ade80",
                        }}>{a.name.charAt(0)}</span>
                    ))}
                    {team.length > 4 && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>+{team.length - 4}</span>}
                  </div>
                )}
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="col-span-2 py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
              No projects yet — create one to organize your tasks and docs
            </div>
          )}
        </div>
      </>)
    }
    </div>
  );
}
