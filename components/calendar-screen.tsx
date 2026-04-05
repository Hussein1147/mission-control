"use client";

import type { CalendarItem, SharedTask, ProjectConfig } from "@/lib/mission-control-data";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    Healthy: { bg: "rgba(34, 197, 94, 0.12)", color: "#4ade80" },
    Watching: { bg: "rgba(245, 158, 11, 0.12)", color: "#fbbf24" },
    Paused: { bg: "rgba(255, 255, 255, 0.06)", color: "var(--text-muted)" },
    todo: { bg: "rgba(255, 255, 255, 0.06)", color: "var(--text-muted)" },
    in_progress: { bg: "rgba(139, 92, 246, 0.12)", color: "#a78bfa" },
    review: { bg: "rgba(245, 158, 11, 0.12)", color: "#fbbf24" },
    done: { bg: "rgba(34, 197, 94, 0.12)", color: "#4ade80" },
  };
  const s = styles[status] || styles.todo;
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: s.bg, color: s.color }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ProjectDot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />;
}

export function CalendarScreen({
  items,
  tasks,
  projects,
}: {
  items: CalendarItem[];
  tasks: SharedTask[];
  projects: ProjectConfig[];
}) {
  // Group tasks with due dates by date
  const tasksWithDates = tasks.filter((t) => t.dueDate);
  const tasksByDate = new Map<string, SharedTask[]>();
  for (const task of tasksWithDates) {
    const date = task.dueDate!.split("T")[0];
    if (!tasksByDate.has(date)) tasksByDate.set(date, []);
    tasksByDate.get(date)!.push(task);
  }
  const sortedDates = [...tasksByDate.keys()].sort();

  const getProjectForTask = (task: SharedTask) => projects.find((p) => p.id === task.project);

  return (
    <div className="p-6 overflow-y-auto h-full animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Calendar</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Task due dates and scheduled system jobs
          </p>
        </div>
      </div>

      {/* Task due dates by date */}
      {sortedDates.length > 0 && (
        <div className="mb-8">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
            Task Schedule
          </h3>
          <div className="flex flex-col gap-4">
            {sortedDates.map((date) => {
              const dateTasks = tasksByDate.get(date)!;
              const dateObj = new Date(date + "T00:00:00");
              const isToday = new Date().toISOString().split("T")[0] === date;
              const isPast = dateObj < new Date() && !isToday;

              return (
                <div key={date} className="flex gap-4">
                  {/* Date column */}
                  <div className="w-[80px] flex-shrink-0 text-right pt-1">
                    <div className={`text-[13px] font-semibold ${isToday ? "" : ""}`}
                      style={{ color: isToday ? "var(--accent-violet)" : isPast ? "var(--text-muted)" : "var(--text-primary)" }}>
                      {dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {isToday ? "Today" : dateObj.toLocaleDateString("en-US", { weekday: "short" })}
                    </div>
                  </div>
                  {/* Tasks column */}
                  <div className="flex-1 flex flex-col gap-2">
                    {dateTasks.map((task) => {
                      const proj = getProjectForTask(task);
                      return (
                        <div key={task.id} className="rounded-lg px-4 py-3 flex items-center gap-3"
                          style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                          {proj ? <ProjectDot color={proj.color} /> : <ProjectDot color="var(--text-muted)" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{task.title}</div>
                            {proj && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{proj.name}</span>}
                          </div>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{task.assignee}</span>
                          <StatusBadge status={task.status} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* System jobs table */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
          System Jobs
        </h3>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-primary)" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                {["Name", "Owner", "Cadence", "Next Run", "Status"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-primary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-primary)" }}>
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{item.title}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{item.purpose}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text-secondary)" }}>{item.owner}</td>
                  <td className="px-4 py-3 text-[12px] font-mono" style={{ color: "var(--text-secondary)" }}>{item.cadence}</td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text-secondary)" }}>{item.nextRun}</td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>No system jobs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
