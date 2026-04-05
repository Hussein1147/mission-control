"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { Task, ActivityItem, SharedTask, AgentConfig, ProjectConfig, TaskAttachment, LoopConfig, TaskTemplate } from "@/lib/mission-control-data";
import { builtinTemplates } from "@/lib/mission-control-data";

type Column = { id: string; label: string; color: string };

const COLUMNS: Column[] = [
  { id: "todo", label: "Backlog", color: "#5c5c66" },
  { id: "in_progress", label: "In Progress", color: "#8b5cf6" },
  { id: "review", label: "Review", color: "#f59e0b" },
  { id: "done", label: "Done", color: "#22c55e" },
];

function toApiStatus(s: string): string {
  const map: Record<string, string> = { Backlog: "todo", "In Progress": "in_progress", Review: "review", Done: "done" };
  return map[s] || s;
}

// --- Card type ---

type CardData = {
  id: string; title: string; notes: string; owner: string;
  provider?: string; priority: string; status: string; isShared: boolean; eta?: string;
  order?: number; blocked?: boolean; blockedReason?: string;
  attachments?: TaskAttachment[];
  dependsOn?: string[];
  taskType?: "standard" | "loop";
  loopConfig?: LoopConfig;
};

// --- Sub-components ---

function PriorityDot({ priority }: { priority: string }) {
  const c = priority === "P0" ? "#ef4444" : priority === "P1" ? "#f59e0b" : "#5c5c66";
  return <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: c }} />;
}

function OwnerBadge({ owner, provider }: { owner: string; provider?: string }) {
  const isClaude = provider === "claude" || owner.toLowerCase().includes("claude");
  const isAgent = provider === "claude" || provider === "codex";
  const bg = isClaude ? "rgba(139,92,246,0.15)" : isAgent ? "rgba(34,197,94,0.15)" : "rgba(56,189,248,0.15)";
  const color = isClaude ? "#a78bfa" : isAgent ? "#4ade80" : "#7dd3fc";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: bg, color }}>
        {isClaude ? "C" : isAgent ? "X" : "H"}
      </span>
      <span className="text-[11px]" style={{ color: "#5c5c66" }}>{owner}</span>
    </div>
  );
}

function TaskDetailModal({
  card, agents, allCards, onClose, onUpdate, onDelete, onMove,
}: {
  card: CardData; agents: AgentConfig[]; allCards: CardData[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<SharedTask>) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, status: string) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.notes);
  const [assignee, setAssignee] = useState(card.owner === "Unassigned" ? "unassigned" : card.owner);
  const [localAttachments, setLocalAttachments] = useState<TaskAttachment[]>(card.attachments || []);
  const [showAddPath, setShowAddPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const attachment: TaskAttachment = await res.json();
      const updated = [...localAttachments, attachment];
      setLocalAttachments(updated);
      onUpdate(card.id, { attachments: updated });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddPath = () => {
    if (!pathInput.trim()) return;
    const attachment: TaskAttachment = {
      id: Date.now().toString(36),
      name: pathInput.trim().split("/").pop() || pathInput.trim(),
      type: "path",
      path: pathInput.trim(),
      addedBy: "human",
      addedAt: new Date().toISOString(),
    };
    const updated = [...localAttachments, attachment];
    setLocalAttachments(updated);
    onUpdate(card.id, { attachments: updated });
    setPathInput("");
    setShowAddPath(false);
  };

  const handleRemoveAttachment = (attachId: string) => {
    const updated = localAttachments.filter((a) => a.id !== attachId);
    setLocalAttachments(updated);
    onUpdate(card.id, { attachments: updated });
  };

  const handleSave = () => {
    const patch: Partial<SharedTask> = {};
    if (title !== card.title) patch.title = title;
    if (description !== card.notes) patch.description = description;
    if (assignee !== (card.owner === "Unassigned" ? "unassigned" : card.owner)) patch.assignee = assignee;
    if (Object.keys(patch).length > 0) {
      onUpdate(card.id, patch);
    }
    onClose();
  };

  const col = COLUMNS.find((c) => c.id === card.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[640px] rounded-2xl overflow-hidden"
        style={{ background: "#111113", border: "1px solid #222228", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#222228" }}>
          <div className="flex items-center gap-3">
            <PriorityDot priority={card.priority} />
            <span className="flex items-center gap-2 px-2 py-0.5 rounded text-[11px] font-medium"
              style={{ background: `${col?.color}20`, color: col?.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: col?.color }} />
              {col?.label}
            </span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-0"
            style={{ background: "rgba(255,255,255,0.06)", color: "#5c5c66" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Title */}
          {card.isShared ? (
            <input type="text" value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              className="w-full text-[18px] font-semibold outline-none bg-transparent border-0"
              style={{ color: "#ececef" }} />
          ) : (
            <h2 className="text-[18px] font-semibold" style={{ color: "#ececef" }}>{card.title}</h2>
          )}

          {/* Description */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-2" style={{ color: "#5c5c66" }}>Description</label>
            {card.isShared ? (
              <textarea value={description}
                onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                rows={5}
                className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none border-0 resize-none leading-relaxed"
                style={{ background: "#0a0a0a", color: "#ececef", border: "1px solid #222228" }}
                placeholder="Add a description..." />
            ) : (
              <p className="text-[13px] leading-relaxed" style={{ color: "#ececef" }}>{card.notes || "No description"}</p>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-wider mb-2" style={{ color: "#5c5c66" }}>Assignee</label>
              {card.isShared ? (
                <select value={assignee}
                  onChange={(e) => { setAssignee(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none cursor-pointer"
                  style={{ background: "#0a0a0a", color: "#ececef", border: "1px solid #222228" }}>
                  <option value="unassigned">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <OwnerBadge owner={card.owner} provider={card.provider} />
              )}
            </div>
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-wider mb-2" style={{ color: "#5c5c66" }}>Priority</label>
              <div className="flex items-center gap-2">
                <PriorityDot priority={card.priority} />
                <span className="text-[12px]" style={{ color: "#ececef" }}>{card.priority}</span>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-wider mb-2" style={{ color: "#5c5c66" }}>Status</label>
              {card.isShared && onMove ? (
                <select value={card.status}
                  onChange={(e) => onMove(card.id, e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none cursor-pointer"
                  style={{ background: "#0a0a0a", color: "#ececef", border: "1px solid #222228" }}>
                  {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              ) : (
                <span className="text-[12px]" style={{ color: col?.color }}>{col?.label}</span>
              )}
            </div>
          </div>

          {card.eta && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "#5c5c66" }}>ETA</label>
              <span className="text-[12px]" style={{ color: "#ececef" }}>{card.eta}</span>
            </div>
          )}

          {/* Dependencies */}
          {card.dependsOn && card.dependsOn.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-2" style={{ color: "#5c5c66" }}>
                Dependencies ({card.dependsOn.length})
              </label>
              <div className="flex flex-col gap-1.5">
                {card.dependsOn.map((depId) => {
                  const dep = allCards.find((c) => c.id === depId);
                  const isDone = dep?.status === "done";
                  return (
                    <div key={depId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: "#0a0a0a", border: `1px solid ${isDone ? "rgba(34,197,94,0.2)" : "#1a1a1f"}` }}>
                      {isDone ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                      )}
                      <span className="flex-1 text-[12px]" style={{ color: isDone ? "#4ade80" : "#ececef" }}>
                        {dep?.title || depId}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: isDone ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)", color: isDone ? "#4ade80" : "#fbbf24" }}>
                        {isDone ? "done" : dep?.status?.replace(/_/g, " ") || "unknown"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Blocked status */}
          {card.blocked && (
            <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <span className="text-[12px] font-semibold" style={{ color: "#ef4444" }}>Blocked</span>
                </div>
                {card.isShared && (
                  <button onClick={() => { onUpdate(card.id, { blocked: false, blockedReason: undefined } as Partial<SharedTask>); onClose(); }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer border-0"
                    style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}>
                    Unblock
                  </button>
                )}
              </div>
              {card.blockedReason && (
                <p className="text-[12px] leading-relaxed" style={{ color: "#ef4444", opacity: 0.8 }}>
                  {card.blockedReason}
                </p>
              )}
            </div>
          )}

          {/* Loop task iteration history */}
          {card.taskType === "loop" && card.loopConfig && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-[10px] uppercase tracking-wider" style={{ color: "#38bdf8" }}>
                  Loop Progress — {card.loopConfig.currentIteration}/{card.loopConfig.maxIterations} iterations
                </label>
                <div className="flex gap-1.5">
                  {card.loopConfig.status === "running" && (
                    <button onClick={() => onUpdate(card.id, { loopConfig: { ...card.loopConfig!, status: "paused" } } as Partial<SharedTask>)}
                      className="px-2 py-1 rounded text-[10px] cursor-pointer border-0"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                      Pause
                    </button>
                  )}
                  {card.loopConfig.status === "paused" && (
                    <button onClick={() => onUpdate(card.id, { loopConfig: { ...card.loopConfig!, status: "running" }, status: "todo" } as Partial<SharedTask>)}
                      className="px-2 py-1 rounded text-[10px] cursor-pointer border-0"
                      style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}>
                      Resume
                    </button>
                  )}
                  {(card.loopConfig.status === "running" || card.loopConfig.status === "paused") && (
                    <button onClick={() => onUpdate(card.id, { loopConfig: { ...card.loopConfig!, status: "stopped" } } as Partial<SharedTask>)}
                      className="px-2 py-1 rounded text-[10px] cursor-pointer border-0"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                      Stop
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(card.loopConfig.currentIteration / card.loopConfig.maxIterations) * 100}%`,
                    background: card.loopConfig.status === "completed" ? "linear-gradient(90deg, #22c55e, #4ade80)" : "linear-gradient(90deg, #0ea5e9, #38bdf8)",
                  }} />
              </div>

              {/* Objective and metric */}
              <div className="rounded-lg p-2.5 mb-3" style={{ background: "#0a0a0a" }}>
                <p className="text-[11px] mb-1" style={{ color: "#5c5c66" }}>Objective: <span style={{ color: "#ececef" }}>{card.loopConfig.objective}</span></p>
                <p className="text-[11px]" style={{ color: "#5c5c66" }}>Metric: <span style={{ color: "#ececef" }}>{card.loopConfig.metric}</span></p>
              </div>

              {/* Iteration history */}
              {card.loopConfig.iterationHistory.length > 0 && (
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                  {[...card.loopConfig.iterationHistory].reverse().map((iter) => (
                    <div key={iter.iteration} className="rounded-lg p-2.5" style={{ background: "#0a0a0a", border: "1px solid #1a1a1f" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold" style={{ color: "#38bdf8" }}>
                          Iteration {iter.iteration}
                        </span>
                        <div className="flex items-center gap-2">
                          {iter.metricValue && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.1)", color: "#38bdf8" }}>
                              {iter.metricValue}
                            </span>
                          )}
                          <span className="text-[10px]" style={{ color: "#5c5c66" }}>
                            {new Date(iter.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: "#8b8b95" }}>
                        {iter.result.length > 200 ? iter.result.slice(0, 200) + "..." : iter.result}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {card.loopConfig.iterationHistory.length === 0 && (
                <p className="text-[11px] text-center py-2" style={{ color: "#5c5c66" }}>No iterations yet — waiting for agent to start.</p>
              )}
            </div>
          )}

          {/* Attachments */}
          {card.isShared && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] uppercase tracking-wider" style={{ color: "#5c5c66" }}>
                  Attachments {localAttachments.length > 0 && `(${localAttachments.length})`}
                </label>
                <div className="flex gap-1.5">
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="px-2 py-1 rounded text-[10px] cursor-pointer border-0 flex items-center gap-1"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#8b8b95" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    {uploading ? "Uploading..." : "Upload"}
                  </button>
                  <button onClick={() => setShowAddPath(!showAddPath)}
                    className="px-2 py-1 rounded text-[10px] cursor-pointer border-0 flex items-center gap-1"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#8b8b95" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
                    </svg>
                    Path
                  </button>
                </div>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />

              {showAddPath && (
                <div className="flex gap-2 mb-2">
                  <input type="text" value={pathInput} onChange={(e) => setPathInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddPath()}
                    placeholder="/path/to/file..." autoFocus
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] outline-none border-0 font-mono"
                    style={{ background: "#0a0a0a", color: "#ececef", border: "1px solid #222228" }} />
                  <button onClick={handleAddPath}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer border-0"
                    style={{ background: "#8b5cf6", color: "#fff" }}>Add</button>
                </div>
              )}

              {localAttachments.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {localAttachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: "#0a0a0a", border: "1px solid #1a1a1f" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5c5c66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span className="flex-1 text-[12px] truncate" style={{ color: "#ececef" }}>{a.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px]"
                        style={{ background: a.type === "file" ? "rgba(139,92,246,0.15)" : "rgba(56,189,248,0.15)", color: a.type === "file" ? "#a78bfa" : "#7dd3fc" }}>
                        {a.type}
                      </span>
                      <button onClick={() => handleRemoveAttachment(a.id)}
                        className="w-5 h-5 rounded flex items-center justify-center cursor-pointer border-0"
                        style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {localAttachments.length === 0 && !showAddPath && (
                <p className="text-[11px] py-2 text-center" style={{ color: "#5c5c66" }}>No attachments</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: "#222228" }}>
          <div>
            {card.isShared && onDelete && (
              <button onClick={() => { onDelete(card.id); onClose(); }}
                className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0"
                style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                Delete task
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0"
              style={{ background: "#19191d", color: "#5c5c66" }}>
              Cancel
            </button>
            {card.isShared && (
              <button onClick={handleSave} disabled={!dirty}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0"
                style={{ background: dirty ? "#8b5cf6" : "#19191d", color: dirty ? "#fff" : "#5c5c66" }}>
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  card, isDragging, onDelete, onMove, menuOpen, onToggleMenu, onDoubleClick,
  selectionMode, selected, onToggleSelect,
}: {
  card: CardData; isDragging: boolean;
  onDelete?: (id: string) => void; onMove?: (id: string, status: string) => void;
  menuOpen: boolean; onToggleMenu: () => void; onDoubleClick?: () => void;
  selectionMode?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="rounded-xl p-3.5 relative"
      style={{
        background: isDragging ? "#1e1e24" : "#141417",
        border: `1px solid ${isDragging ? "#8b5cf6" : hovered ? "#222228" : "#1a1a1f"}`,
        boxShadow: isDragging ? "0 12px 40px rgba(0,0,0,0.5)" : "none",
        transform: isDragging ? "rotate(1.5deg) scale(1.02)" : "none",
        transition: isDragging ? "none" : "border-color 0.15s, background 0.15s",
        cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (menuOpen) onToggleMenu(); }}
      onDoubleClick={selectionMode ? undefined : onDoubleClick}
      onClick={selectionMode ? (e) => { e.stopPropagation(); onToggleSelect?.(card.id); } : undefined}
    >
      {/* Selection checkbox */}
      {selectionMode && (
        <div className="absolute top-2 left-2 z-10">
          <div className="w-5 h-5 rounded border flex items-center justify-center"
            style={{
              background: selected ? "#8b5cf6" : "transparent",
              borderColor: selected ? "#8b5cf6" : "#3a3a42",
            }}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
      )}
      {/* Action buttons */}
      {card.isShared && hovered && !isDragging && (
        <div className="absolute top-2 right-2 flex gap-1 z-10">
          <button onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
            className="w-6 h-6 rounded flex items-center justify-center cursor-pointer border-0"
            style={{ background: "rgba(255,255,255,0.1)", color: "#8b8b95" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          {onDelete && (
            <button onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
              className="w-6 h-6 rounded flex items-center justify-center cursor-pointer border-0"
              style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Move dropdown */}
      {menuOpen && onMove && (
        <div className="absolute top-10 right-2 z-30 rounded-lg py-1 min-w-[140px]"
          style={{ background: "#19191d", border: "1px solid #222228", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider" style={{ color: "#5c5c66" }}>Move to</div>
          {COLUMNS.filter((c) => c.id !== card.status).map((col) => (
            <button key={col.id} onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onMove(card.id, col.id); }}
              className="w-full px-3 py-1.5 text-left text-[12px] cursor-pointer border-0 bg-transparent flex items-center gap-2"
              style={{ color: "#ececef" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
              {col.label}
            </button>
          ))}
        </div>
      )}

      {card.blocked && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <span className="text-[10px] font-semibold" style={{ color: "#ef4444" }}>Blocked</span>
        </div>
      )}
      {card.taskType === "loop" && card.loopConfig && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md"
          style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span className="text-[10px] font-semibold" style={{ color: "#38bdf8" }}>
            Loop {card.loopConfig.currentIteration}/{card.loopConfig.maxIterations}
          </span>
          {card.loopConfig.status === "paused" && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>paused</span>
          )}
        </div>
      )}
      <div className="flex items-start gap-2 mb-2 pr-8">
        <PriorityDot priority={card.priority} />
        <span className="text-[13px] font-medium leading-snug" style={{ color: card.blocked ? "#8b8b95" : "#ececef" }}>
          {card.title.length > 36 ? card.title.slice(0, 36) + "..." : card.title}
        </span>
      </div>
      {card.notes && (
        <p className="text-[12px] leading-relaxed mb-3 ml-4" style={{ color: "#5c5c66" }}>
          {card.notes.length > 80 ? card.notes.slice(0, 80) + "..." : card.notes}
        </p>
      )}
      <div className="flex items-center justify-between ml-4">
        <OwnerBadge owner={card.owner} provider={card.provider} />
        <div className="flex items-center gap-2">
          {card.dependsOn && card.dependsOn.length > 0 && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "#f59e0b" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              {card.dependsOn.length}
            </span>
          )}
          {card.attachments && card.attachments.length > 0 && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "#5c5c66" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              {card.attachments.length}
            </span>
          )}
          {card.eta && <span className="text-[10px]" style={{ color: "#5c5c66" }}>{card.eta}</span>}
        </div>
      </div>
    </div>
  );
}

function StatsBar({ cards }: { cards: CardData[] }) {
  const total = cards.length;
  const inProg = cards.filter((c) => c.status === "in_progress").length;
  const blocked = cards.filter((c) => c.blocked).length;
  const done = cards.filter((c) => c.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-8 mb-6">
      {[
        { v: total, l: "Total", c: "#8b5cf6" }, { v: inProg, l: "In progress", c: "#ececef" },
        ...(blocked > 0 ? [{ v: blocked, l: "Blocked", c: "#ef4444" }] : []),
        { v: done, l: "Done", c: "#22c55e" }, { v: `${pct}%`, l: "Completion", c: "#22c55e" },
      ].map((s) => (
        <div key={s.l} className="flex items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color: s.c }}>{s.v}</span>
          <span className="text-[12px]" style={{ color: "#5c5c66" }}>{s.l}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const tc = (t: string) => t === "violet" ? "#a78bfa" : t === "emerald" ? "#4ade80" : t === "amber" ? "#fbbf24" : "#7dd3fc";
  return (
    <div className="p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "#5c5c66" }}>Activity</h3>
      <div className="flex flex-col gap-3">
        {items.slice(0, 20).map((i) => (
          <div key={i.id} className="flex gap-3">
            <div className="flex flex-col items-center mt-1">
              <div className="w-2 h-2 rounded-full" style={{ background: tc(i.tone) }} />
              <div className="w-px flex-1 mt-1" style={{ background: "#222228" }} />
            </div>
            <div className="pb-3">
              <p className="text-[12px] font-medium" style={{ color: "#ececef" }}>{i.title}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "#5c5c66" }}>{i.detail.length > 120 ? i.detail.slice(0, 120) + "..." : i.detail}</p>
              <p className="text-[10px] mt-1" style={{ color: "#5c5c66", opacity: 0.6 }}>{i.time}</p>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-[12px] text-center py-4" style={{ color: "#5c5c66" }}>No activity yet</p>}
      </div>
    </div>
  );
}

// --- Main TaskBoard ---
// The board owns its own card state to prevent polling from killing drag state.

export function TaskBoard({
  tasks, sharedTasks, activity, agents, projects,
  onCreateTask, onUpdateTask, onDeleteTask,
}: {
  tasks: Task[]; sharedTasks: SharedTask[]; activity: ActivityItem[];
  agents: AgentConfig[]; projects: ProjectConfig[];
  onCreateTask: (title: string, description: string, assignee?: string, project?: string, dueDate?: string) => void;
  onUpdateTask: (id: string, patch: Partial<SharedTask>) => void;
  onDeleteTask: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [newAssignee, setNewAssignee] = useState("unassigned");
  const [newProject, setNewProject] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newTaskType, setNewTaskType] = useState<"standard" | "loop">("standard");
  const [newLoopObjective, setNewLoopObjective] = useState("");
  const [newLoopMetric, setNewLoopMetric] = useState("");
  const [newLoopMaxIter, setNewLoopMaxIter] = useState(10);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateProject, setTemplateProject] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");

  // LOCAL card state — this is the source of truth for the board UI.
  // Polling merges new/updated cards in without blowing away local status changes.
  const [localCards, setLocalCards] = useState<CardData[]>([]);
  const isDragging = useRef(false);
  // Track cards that were locally moved (drag/move menu) — preserve their status until server confirms
  const locallyMovedRef = useRef(new Set<string>());

  // Build cards from props
  const buildCards = useCallback((): CardData[] => {
    return [
      ...sharedTasks.map((t) => ({
        id: t.id, title: t.title, notes: t.description,
        owner: t.assignee === "unassigned" ? "Unassigned" : t.assignee,
        provider: agents.find((a) => a.id === t.assignee)?.provider,
        priority: t.priority, status: t.status, isShared: true,
        order: t.order, blocked: t.blocked, blockedReason: t.blockedReason,
        attachments: t.attachments, dependsOn: t.dependsOn,
        taskType: t.taskType, loopConfig: t.loopConfig,
      })),
      ...tasks.map((t) => ({
        id: t.id, title: t.title, notes: t.notes, owner: t.owner,
        provider: undefined, priority: t.priority,
        status: toApiStatus(t.status), isShared: false, eta: t.eta,
      })),
    ];
  }, [sharedTasks, tasks, agents]);

  // Merge incoming data without overwriting local status changes for recently-dragged cards
  useEffect(() => {
    if (isDragging.current) return; // NEVER update during drag

    const incoming = buildCards();

    setLocalCards((prev) => {
      if (prev.length === 0) return incoming; // first load

      const localStatusMap = new Map(prev.map((c) => [c.id, c.status]));
      const localOrderMap = new Map(prev.map((c) => [c.id, c.order]));
      const movedSet = locallyMovedRef.current;

      const merged = incoming.map((card) => {
        if (movedSet.has(card.id)) {
          const localStatus = localStatusMap.get(card.id);
          const localOrder = localOrderMap.get(card.id);
          // Server caught up — clear the locally-moved flag
          if (localStatus === card.status) {
            movedSet.delete(card.id);
            return card;
          }
          // Server hasn't caught up yet — keep local status/order
          return { ...card, status: localStatus ?? card.status, order: localOrder ?? card.order };
        }
        // Not locally moved — always accept server state
        return card;
      });

      // Remove cards that no longer exist in incoming (deleted)
      const incomingIds = new Set(incoming.map((c) => c.id));
      return merged.filter((c) => incomingIds.has(c.id));
    });
  }, [buildCards]);

  const isReadOnly = filter === "all";

  const archivedProjectIds = new Set(projects.filter((p) => p.status === "archived").map((p) => p.id));
  const filtered = localCards.filter((c) => {
    // Hide tasks from archived projects
    const taskProject = sharedTasks.find((t) => t.id === c.id)?.project;
    if (taskProject && archivedProjectIds.has(taskProject)) return false;
    // Agent filter
    const agentMatch = filter === "all" ? true : filter === "shared" ? c.isShared : c.owner.toLowerCase() === filter.toLowerCase();
    // Project filter — match by looking up the shared task's project
    const projMatch = projectFilter === "all" ? true :
      projectFilter === "none" ? !taskProject :
      taskProject === projectFilter;
    return agentMatch && projMatch;
  }).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  // --- Drag handlers ---
  const onDragStart = () => {
    if (isReadOnly) return;
    isDragging.current = true;
    setMenuTaskId(null);
  };

  const onDragEnd = (result: DropResult) => {
    isDragging.current = false;
    if (isReadOnly) return;
    const { draggableId, destination, source } = result;
    if (!destination) return;

    const newStatus = destination.droppableId;
    const card = localCards.find((c) => c.id === draggableId);
    if (!card || !card.isShared) return;

    // Same column, same index — no-op
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Mark as locally moved so merge logic preserves our status until server confirms
    locallyMovedRef.current.add(draggableId);

    // Compute new order values for all cards in the destination column
    setLocalCards((prev) => {
      const updated = prev.map((c) => c.id === draggableId ? { ...c, status: newStatus } : c);

      // Get cards in the destination column (excluding the dragged card, then insert at dest index)
      const destCards = updated.filter((c) => c.status === newStatus && c.id !== draggableId);
      const movedCard = updated.find((c) => c.id === draggableId)!;
      destCards.splice(destination.index, 0, movedCard);

      // Assign sequential order values
      const orderMap = new Map<string, number>();
      destCards.forEach((c, i) => orderMap.set(c.id, i));

      // Also reorder the source column if it's different
      if (source.droppableId !== destination.droppableId) {
        const srcCards = updated.filter((c) => c.status === source.droppableId && c.id !== draggableId);
        srcCards.forEach((c, i) => orderMap.set(c.id, i));
      }

      return updated.map((c) => {
        const newOrder = orderMap.get(c.id);
        return newOrder !== undefined ? { ...c, order: newOrder } : c;
      });
    });

    // Persist: update the dragged card's status + order, and batch-update orders for siblings
    const destCards = localCards
      .filter((c) => c.status === (newStatus === card.status ? card.status : newStatus) && c.id !== draggableId && c.isShared);
    // For simplicity, just persist the dragged card with its new status and order
    onUpdateTask(card.id, { status: newStatus as SharedTask["status"], order: destination.index });

    // Also persist order for other shared cards in the destination column
    const allInDest = localCards.filter((c) => c.status === newStatus && c.id !== draggableId);
    allInDest.splice(destination.index, 0, card);
    allInDest.forEach((c, i) => {
      if (c.id !== draggableId && c.isShared) {
        onUpdateTask(c.id, { order: i });
      }
    });
  };

  const moveTask = (taskId: string, newStatus: string) => {
    locallyMovedRef.current.add(taskId);
    setLocalCards((prev) => {
      const updated = prev.map((c) => c.id === taskId ? { ...c, status: newStatus } : c);
      // Assign order at end of destination column
      const destCards = updated.filter((c) => c.status === newStatus);
      const newOrder = destCards.length - 1;
      return updated.map((c) => c.id === taskId ? { ...c, order: newOrder } : c);
    });
    const destCount = localCards.filter((c) => c.status === newStatus).length;
    onUpdateTask(taskId, { status: newStatus as SharedTask["status"], order: destCount });
    setMenuTaskId(null);
  };

  const deleteTask = (taskId: string) => {
    setLocalCards((prev) => prev.filter((c) => c.id !== taskId));
    onDeleteTask(taskId);
  };

  const handleNewTask = () => {
    if (!newTitle.trim()) return;
    // For loop tasks, create with loopConfig
    if (newTaskType === "loop") {
      const loopTask: Partial<SharedTask> = {
        title: newTitle.trim(),
        description: newDesc.trim() || newLoopObjective.trim(),
        assignee: newAssignee || "unassigned",
        project: newProject || undefined,
        dueDate: newDueDate || undefined,
        taskType: "loop",
        loopConfig: {
          objective: newLoopObjective.trim(),
          metric: newLoopMetric.trim(),
          maxIterations: newLoopMaxIter,
          currentIteration: 0,
          iterationHistory: [],
          status: "running",
        },
        createdBy: "human",
      };
      // Use onUpdateTask path — actually need to POST raw
      fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loopTask) });
    } else {
      onCreateTask(newTitle.trim(), newDesc.trim(), newAssignee || "unassigned", newProject || undefined, newDueDate || undefined);
    }
    setNewTitle(""); setNewDesc(""); setNewAssignee("unassigned"); setNewProject(""); setNewDueDate("");
    setNewTaskType("standard"); setNewLoopObjective(""); setNewLoopMetric(""); setNewLoopMaxIter(10);
    setShowNewTask(false);
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6 overflow-y-auto min-w-0">
        <StatsBar cards={localCards.filter((c) => { const tp = sharedTasks.find((t) => t.id === c.id)?.project; return !tp || !archivedProjectIds.has(tp); })} />

        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <button onClick={() => setShowNewTask(!showNewTask)}
            className="w-7 h-7 rounded-lg text-[16px] font-medium flex items-center justify-center cursor-pointer border-0"
            style={{ background: "#8b5cf6", color: "#fff" }}
            title="New task">
            +
          </button>
          {[{ key: "all", label: "All" }, { key: "shared", label: "Orchestrated" },
            ...agents.map((a) => ({ key: a.id, label: a.name }))].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-2.5 py-1.5 rounded-lg text-[12px] cursor-pointer border-0 whitespace-nowrap"
              style={{ background: filter === f.key ? "#19191d" : "transparent", color: filter === f.key ? "#ececef" : "#5c5c66" }}>
              {f.label}
            </button>
          ))}

          {/* Project filter */}
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-[11px] cursor-pointer border-0 appearance-none"
              style={{
                background: projectFilter !== "all" ? "rgba(139,92,246,0.12)" : "rgba(92,92,102,0.15)",
                color: projectFilter !== "all" ? "#a78bfa" : "#8b8b95",
                maxWidth: 140,
              }}
            >
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {projects.filter((p) => p.status !== "archived").map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* Selection mode toggle + bulk actions */}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { setSelectionMode(!selectionMode); setSelectedTasks(new Set()); }}
              className="px-3 py-2 rounded-lg text-[13px] cursor-pointer border-0"
              style={{ background: selectionMode ? "rgba(239,68,68,0.15)" : "transparent", color: selectionMode ? "#f87171" : "#5c5c66" }}>
              {selectionMode ? "Cancel" : "Select"}
            </button>
            {selectionMode && (
              <>
                <button onClick={() => {
                  const allIds = sharedTasks.map((t) => t.id);
                  setSelectedTasks(selectedTasks.size === allIds.length ? new Set() : new Set(allIds));
                }}
                  className="px-3 py-2 rounded-lg text-[13px] cursor-pointer border-0"
                  style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>
                  {selectedTasks.size === sharedTasks.length ? "Deselect All" : "Select All"}
                </button>
                {selectedTasks.size > 0 && (
                  <button onClick={() => {
                    if (confirm(`Delete ${selectedTasks.size} task(s)?`)) {
                      selectedTasks.forEach((id) => onDeleteTask(id));
                      setSelectedTasks(new Set());
                      setSelectionMode(false);
                    }
                  }}
                    className="px-3 py-2 rounded-lg text-[13px] cursor-pointer border-0"
                    style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                    Delete ({selectedTasks.size})
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* New task form */}
        {showNewTask && (
          <div className="rounded-xl p-4 mb-4 animate-fade-in" style={{ background: "#141417", border: "1px solid #222228" }}>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Task title..." autoFocus
              className="w-full mb-2 px-3 py-2 rounded-lg text-[13px] outline-none border-0"
              style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description..." rows={2}
              className="w-full mb-3 px-3 py-2 rounded-lg text-[12px] outline-none border-0 resize-none"
              style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
            {/* Task type toggle */}
            <div className="flex gap-2 mb-3">
              <button onClick={() => setNewTaskType("standard")}
                className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0 transition-colors"
                style={{ background: newTaskType === "standard" ? "#8b5cf6" : "#111113", color: newTaskType === "standard" ? "#fff" : "#5c5c66" }}>
                Standard
              </button>
              <button onClick={() => setNewTaskType("loop")}
                className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0 transition-colors flex items-center gap-1.5"
                style={{ background: newTaskType === "loop" ? "#0ea5e9" : "#111113", color: newTaskType === "loop" ? "#fff" : "#5c5c66" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Loop Task
              </button>
            </div>

            {/* Loop task fields */}
            {newTaskType === "loop" && (
              <div className="rounded-lg p-3 mb-3" style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)" }}>
                <textarea value={newLoopObjective} onChange={(e) => setNewLoopObjective(e.target.value)} placeholder="Objective — what should the agent achieve?" rows={2}
                  className="w-full mb-2 px-3 py-2 rounded-lg text-[12px] outline-none border-0 resize-none"
                  style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input type="text" value={newLoopMetric} onChange={(e) => setNewLoopMetric(e.target.value)} placeholder="Success metric (e.g., test pass rate)"
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none border-0"
                      style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
                  </div>
                  <div className="w-[120px]">
                    <label className="block text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "#5c5c66" }}>Max iterations</label>
                    <input type="number" min={1} max={100} value={newLoopMaxIter} onChange={(e) => setNewLoopMaxIter(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none border-0"
                      style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "#5c5c66" }}>Assign to</label>
                <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none cursor-pointer"
                  style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }}>
                  <option value="unassigned">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "#5c5c66" }}>Project</label>
                <select value={newProject} onChange={(e) => setNewProject(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none cursor-pointer"
                  style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }}>
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "#5c5c66" }}>Due date</label>
                <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none"
                  style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleNewTask} className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0"
                style={{ background: "#8b5cf6", color: "#fff" }}>Create</button>
              <button onClick={() => setShowNewTask(false)} className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border-0"
                style={{ background: "#111113", color: "#5c5c66" }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Template picker */}
        {showTemplatePicker && (
          <div className="rounded-xl p-4 mb-4 animate-fade-in" style={{ background: "#141417", border: "1px solid #222228" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold" style={{ color: "#ececef" }}>Create from Template</h3>
              <button onClick={() => setShowTemplatePicker(false)} className="text-[11px] cursor-pointer border-0 bg-transparent" style={{ color: "#5c5c66" }}>Close</button>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "#5c5c66" }}>Assign to project</label>
              <select value={templateProject} onChange={(e) => setTemplateProject(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none cursor-pointer"
                style={{ background: "#111113", color: "#ececef", border: "1px solid #222228" }}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {builtinTemplates.map((tmpl) => (
                <button key={tmpl.id}
                  onClick={async () => {
                    await fetch("/api/templates", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ templateId: tmpl.id, projectId: templateProject || undefined }),
                    });
                    setShowTemplatePicker(false);
                    setTemplateProject("");
                  }}
                  className="rounded-lg p-3 text-left cursor-pointer border-0 transition-colors"
                  style={{ background: "#111113", border: "1px solid #1a1a1f" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38bdf8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1f"; }}
                >
                  <div className="text-[13px] font-semibold mb-1" style={{ color: "#ececef" }}>{tmpl.name}</div>
                  <div className="text-[11px] mb-2" style={{ color: "#5c5c66" }}>{tmpl.description}</div>
                  <div className="text-[10px]" style={{ color: "#38bdf8" }}>{tmpl.tasks.length} tasks with dependencies</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Kanban Board */}
        <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLUMNS.map((col) => {
              const colCards = filtered.filter((c) => c.status === col.id);
              return (
                <Droppable key={col.id} droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="min-h-[300px] min-w-[240px] flex-1 rounded-xl p-3 transition-all duration-200"
                      style={{
                        background: snapshot.isDraggingOver ? "rgba(139,92,246,0.06)" : "transparent",
                        border: snapshot.isDraggingOver ? "2px dashed rgba(139,92,246,0.35)" : "2px solid transparent",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                        <span className="text-[13px] font-semibold" style={{ color: "#ececef" }}>{col.label}</span>
                        <span className="text-[12px] ml-1" style={{ color: "#5c5c66" }}>{colCards.length}</span>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {colCards.map((card, index) => (
                          <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={isReadOnly}>
                            {(dragProvided, dragSnapshot) => (
                              <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps}>
                                <TaskCard card={card} isDragging={dragSnapshot.isDragging}
                                  onDelete={!isReadOnly && card.isShared ? deleteTask : undefined}
                                  onMove={!isReadOnly && card.isShared ? moveTask : undefined}
                                  menuOpen={menuTaskId === card.id}
                                  onToggleMenu={() => setMenuTaskId(menuTaskId === card.id ? null : card.id)}
                                  onDoubleClick={() => setDetailCardId(card.id)}
                                  selectionMode={selectionMode}
                                  selected={selectedTasks.has(card.id)}
                                  onToggleSelect={(id) => {
                                    const next = new Set(selectedTasks);
                                    next.has(id) ? next.delete(id) : next.add(id);
                                    setSelectedTasks(next);
                                  }} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {colCards.length === 0 && !snapshot.isDraggingOver && (
                          <div className="rounded-xl py-10 text-center text-[12px]"
                            style={{ color: "#5c5c66", border: "1px dashed #222228" }}>No tasks</div>
                        )}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {/* Right panel toggle */}
      <button onClick={() => setRightPanelOpen(!rightPanelOpen)}
        className="w-6 flex-shrink-0 flex items-center justify-center cursor-pointer border-0"
        style={{ background: "#0a0a0a", borderLeft: "1px solid #222228", color: "#5c5c66" }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: rightPanelOpen ? "rotate(0)" : "rotate(180deg)", transition: "transform 0.2s" }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {rightPanelOpen && (
        <div className="w-[300px] min-w-[300px] border-l flex flex-col h-full" style={{ borderColor: "#222228", background: "#0a0a0a" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#222228" }}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#5c5c66" }}>Activity</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ActivityFeed items={activity} />
          </div>
        </div>
      )}

      {/* Task detail modal */}
      {detailCardId && (() => {
        const detailCard = localCards.find((c) => c.id === detailCardId);
        if (!detailCard) return null;
        return (
          <TaskDetailModal
            card={detailCard}
            agents={agents}
            allCards={localCards}
            onClose={() => setDetailCardId(null)}
            onUpdate={(id, patch) => { onUpdateTask(id, patch); }}
            onDelete={detailCard.isShared ? (id) => { deleteTask(id); setDetailCardId(null); } : undefined}
            onMove={detailCard.isShared ? moveTask : undefined}
          />
        );
      })()}
    </div>
  );
}
