"use client";

import type { ScreenId, Channel } from "@/lib/mission-control-data";

type NavSection = {
  label: string;
  items: { id: ScreenId; label: string; icon: string }[];
};

const sections: NavSection[] = [
  {
    label: "WORKSPACE",
    items: [
      { id: "task-board", label: "Tasks", icon: "grid" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "projects", label: "Projects", icon: "folder" },
    ],
  },
  {
    label: "KNOWLEDGE",
    items: [
      { id: "memory", label: "Memory", icon: "brain" },
      { id: "docs", label: "Docs", icon: "file" },
    ],
  },
  {
    label: "AGENT",
    items: [
      { id: "team", label: "Team", icon: "users" },
      { id: "office", label: "Office", icon: "building" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { id: "settings", label: "Settings", icon: "settings" },
      { id: "approvals", label: "Approvals", icon: "shield" },
    ],
  },
];

function NavIcon({ type, active }: { type: string; active: boolean }) {
  const color = active ? "#ececef" : "#5c5c66";
  const props = {
    width: 16,
    height: 16,
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "grid":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "folder":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "brain":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" />
          <path d="M3.6 9h16.8" />
          <path d="M3.6 15h16.8" />
        </svg>
      );
    case "file":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "users":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "building":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="9" y1="6" x2="9" y2="6.01" />
          <line x1="15" y1="6" x2="15" y2="6.01" />
          <line x1="9" y1="10" x2="9" y2="10.01" />
          <line x1="15" y1="10" x2="15" y2="10.01" />
          <line x1="9" y1="14" x2="9" y2="14.01" />
          <line x1="15" y1="14" x2="15" y2="14.01" />
          <path d="M10 18h4v4h-4z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...props} viewBox="0 0 24 24">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    default:
      return null;
  }
}

export function Sidebar({
  active,
  onNavigate,
  counts,
  collapsed,
  onToggle,
  channels,
  activeChannelId,
  onSelectChannel,
  channelUnreadCounts,
}: {
  active: ScreenId;
  onNavigate: (id: ScreenId) => void;
  counts?: Partial<Record<ScreenId, number>>;
  collapsed: boolean;
  onToggle: () => void;
  channels?: Channel[];
  activeChannelId?: string | null;
  onSelectChannel?: (channelId: string) => void;
  channelUnreadCounts?: Record<string, number>;
}) {
  return (
    <aside
      className="h-screen flex flex-col border-r transition-all duration-200"
      style={{
        width: collapsed ? 56 : 220,
        minWidth: collapsed ? 56 : 220,
        borderColor: "var(--border-primary)",
        background: "#0e0e11",
      }}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center gap-2.5 px-3 py-4 border-b" style={{ borderColor: "var(--border-primary)" }}>
        <button
          onClick={onToggle}
          className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-0 flex-shrink-0"
          style={{ background: "rgba(139, 92, 246, 0.15)" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24" />
          </svg>
        </button>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
              CONTROL
            </span>
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Mission Control
            </span>
          </div>
        )}
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <div className="flex items-center gap-1 px-2 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                  {section.label}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-px">
              {section.items.map((item) => {
                const isActive = active === item.id;
                const count = counts?.[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5 px-2.5"} py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-100 cursor-pointer border-0 w-full text-left`}
                    style={{
                      background: isActive ? "rgba(139, 92, 246, 0.1)" : "transparent",
                      color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                      borderLeft: collapsed ? "none" : isActive ? "2px solid var(--accent-violet)" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-muted)";
                      }
                    }}
                    title={collapsed ? item.label : undefined}
                  >
                    <NavIcon type={item.icon} active={isActive} />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Channels section */}
        {channels && channels.length > 0 && (
          <div className="mb-4">
            {!collapsed && (
              <div className="flex items-center gap-1 px-2 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                  CHANNELS
                </span>
              </div>
            )}
            <div className="flex flex-col gap-px">
              {channels.map((ch) => {
                const isActive = activeChannelId === ch.id;
                return (
                  <button
                    key={ch.id}
                    onClick={() => onSelectChannel?.(ch.id)}
                    className={`flex items-center ${collapsed ? "justify-center" : "gap-2 px-2.5"} py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-100 cursor-pointer border-0 w-full text-left`}
                    style={{
                      background: isActive ? "rgba(139, 92, 246, 0.1)" : "transparent",
                      color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                      borderLeft: collapsed ? "none" : isActive ? "2px solid var(--accent-violet)" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-muted)";
                      }
                    }}
                    title={collapsed ? `#${ch.name}` : undefined}
                  >
                    {(() => {
                      const unread = channelUnreadCounts?.[ch.id] || 0;
                      return collapsed ? (
                        <span className="relative text-[11px] font-bold" style={{ color: isActive ? "#a78bfa" : "#5c5c66" }}>
                          #
                          {unread > 0 && (
                            <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                              style={{ background: "#ef4444", color: "#fff" }}>{unread > 9 ? "9+" : unread}</span>
                          )}
                        </span>
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span style={{ color: "#5c5c66" }}>#</span>
                            <span>{ch.name}</span>
                          </div>
                          {unread > 0 && (
                            <span className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold px-1"
                              style={{ background: "#ef4444", color: "#fff" }}>{unread > 99 ? "99+" : unread}</span>
                          )}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className={`${collapsed ? "px-2 justify-center" : "px-4"} py-3 border-t flex items-center gap-2`} style={{ borderColor: "var(--border-primary)" }}>
        <div className="w-2 h-2 rounded-full animate-pulse-dot flex-shrink-0" style={{ background: "var(--accent-green)" }} />
        {!collapsed && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Local runtime</span>}
      </div>
    </aside>
  );
}
