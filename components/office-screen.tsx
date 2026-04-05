"use client";

import type { OfficeSeat } from "@/lib/mission-control-data";

function statusEmoji(status: string, mood: string): string {
  const m = mood.toLowerCase();
  if (m.includes("review")) return "📋";
  if (m.includes("wir") || m.includes("build") || m.includes("integrat")) return "🔨";
  if (m.includes("link") || m.includes("memory") || m.includes("doc")) return "🧠";
  if (m.includes("triag") || m.includes("routine")) return "🔄";
  if (m.includes("wait")) return "☕";
  if (status === "Working") return "🎯";
  if (status === "Syncing") return "🔄";
  return "💤";
}

function SeatCard({ seat }: { seat: OfficeSeat }) {
  const statusColor =
    seat.status === "Working" ? "var(--accent-green)" :
    seat.status === "Syncing" ? "var(--accent-violet)" :
    "var(--text-muted)";

  const emoji = statusEmoji(seat.status, seat.mood || "");

  return (
    <div
      className="rounded-xl p-5 flex flex-col items-center text-center transition-all duration-200"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-card-hover)";
        e.currentTarget.style.borderColor = "var(--border-primary)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-card)";
        e.currentTarget.style.borderColor = "var(--border-subtle)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Avatar with pixel-art feel */}
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-3 relative"
        style={{ background: "rgba(139, 92, 246, 0.1)" }}>
        {emoji}
        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2"
          style={{ background: statusColor, borderColor: "var(--bg-card)" }} />
      </div>

      <span className="text-[14px] font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>
        {seat.name}
      </span>
      <span className="text-[11px] mb-2" style={{ color: "var(--accent-violet)" }}>
        {seat.role}
      </span>
      <span className="text-[11px] px-2 py-0.5 rounded-full"
        style={{
          background: seat.status === "Working" ? "rgba(34, 197, 94, 0.1)" :
                      seat.status === "Syncing" ? "rgba(139, 92, 246, 0.1)" :
                      "rgba(255, 255, 255, 0.04)",
          color: statusColor,
        }}>
        {seat.status}
      </span>
      {seat.mood && (
        <span className="text-[10px] mt-1.5 leading-snug text-center" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
          {seat.mood}
        </span>
      )}
    </div>
  );
}

export function OfficeScreen({ seats }: { seats: OfficeSeat[] }) {
  const working = seats.filter((s) => s.status === "Working").length;
  const syncing = seats.filter((s) => s.status === "Syncing").length;
  const idle = seats.filter((s) => s.status === "Idle").length;

  return (
    <div className="p-6 overflow-y-auto h-full animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>The Office</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            See what everyone is up to
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent-green)" }} />
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{working} working</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent-violet)" }} />
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{syncing} syncing</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-muted)" }} />
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{idle} idle</span>
          </div>
        </div>
      </div>

      {/* Office floor */}
      <div className="rounded-2xl p-8 relative" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", minHeight: 400 }}>
        {/* Decorative grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "radial-gradient(circle, var(--text-primary) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

        {/* Water cooler area */}
        <div className="text-center mb-8 relative">
          <span className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full"
            style={{ background: "rgba(139, 92, 246, 0.08)", color: "var(--text-muted)" }}>
            🏢 Floor Plan
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 relative">
          {seats.map((seat) => (
            <SeatCard key={seat.name} seat={seat} />
          ))}
          {seats.length === 0 && (
            <div className="col-span-3 py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
              No one is in the office
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
