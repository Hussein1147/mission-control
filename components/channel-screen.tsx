"use client";

import { useState, useRef, useEffect, memo, useCallback } from "react";
import type { Channel, ChannelMessage, AgentConfig } from "@/lib/mission-control-data";

function TypingIndicator({ agent }: { agent: AgentConfig }) {
  const isClaude = agent.provider === "claude";
  const color = isClaude ? "#a78bfa" : "#4ade80";
  return (
    <div className="flex gap-3 py-2 px-4 animate-fade-in">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
        style={{ background: `${color}20`, color }}
      >
        {agent.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-semibold" style={{ color: "#ececef" }}>{agent.name}</span>
          <span className="text-[11px]" style={{ color: "#5c5c66" }}>typing...</span>
        </div>
        <div className="flex gap-1 items-center py-1.5">
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "0ms", animationDuration: "1.2s" }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "200ms", animationDuration: "1.2s" }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "400ms", animationDuration: "1.2s" }} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, agents, onDelete }: { msg: ChannelMessage; agents: AgentConfig[]; onDelete?: (id: string) => void }) {
  const sender = agents.find((a) => a.id === msg.from);
  const isHuman = msg.from === "human";
  const isSystem = msg.from === "system";
  const providerColor = sender?.provider === "claude" ? "#a78bfa" : sender?.provider === "codex" ? "#4ade80" : "#7dd3fc";
  const avatarBg = isSystem ? "rgba(139,92,246,0.15)" : isHuman ? "rgba(56,189,248,0.15)" : `${providerColor}20`;
  const avatarColor = isSystem ? "#a78bfa" : isHuman ? "#7dd3fc" : providerColor;

  return (
    <div className="group flex gap-3 py-2 px-4 hover:bg-white/[0.02] transition-colors relative">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
        style={{ background: avatarBg, color: avatarColor }}
      >
        {(sender?.name || msg.from).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold" style={{ color: "#ececef" }}>
            {sender?.name || (isHuman ? "You" : msg.from)}
          </span>
          <span className="text-[11px]" style={{ color: "#5c5c66" }}>
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "#b4b4bb" }}>
          {msg.content}
        </p>
        {msg.taskId && (
          <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded text-[11px]"
            style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Linked task
          </span>
        )}
      </div>
      {onDelete && (
        <button
          onClick={() => onDelete(msg.id)}
          className="absolute top-2 right-3 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center cursor-pointer border-0"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
          title="Delete message"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ChannelScreen({
  channel,
  channelMessages,
  agents,
  onSend,
  onDeleteMessage,
}: {
  channel: Channel;
  channelMessages: ChannelMessage[];
  agents: AgentConfig[];
  onSend: (channelId: string, content: string) => void;
  onDeleteMessage?: (messageId: string) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filtered = channelMessages.filter((m) => m.channelId === channel.id);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "#222228" }}>
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: "#ececef" }}>
            <span style={{ color: "#5c5c66" }}>#</span> {channel.name}
          </h2>
          {channel.description && (
            <p className="text-[12px] mt-0.5" style={{ color: "#5c5c66" }}>{channel.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {agents.map((a) => {
            const isClaude = a.provider === "claude";
            return (
              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                style={{ background: "rgba(255,255,255,0.03)" }}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: isClaude ? "rgba(139,92,246,0.15)" : "rgba(34,197,94,0.15)", color: isClaude ? "#a78bfa" : "#4ade80" }}>
                  {a.name.charAt(0)}
                </span>
                <span className="text-[11px]" style={{ color: "#8b8b95" }}>{a.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "#5c5c66" }}>
            <span className="text-3xl" style={{ color: "#222228" }}>#</span>
            <p className="text-[13px]">No messages in <span className="font-semibold">#{channel.name}</span> yet</p>
            <p className="text-[11px]">Send a message to get started</p>
          </div>
        )}
        {filtered.map((msg) => {
          // Render phase markers as visual dividers
          const isStartMarker = /^--- START (DISCOVERY|RETROSPECTIVE):/.test(msg.content);
          const isEndMarker = /^--- END (DISCOVERY|RETROSPECTIVE):/.test(msg.content);
          const isConsensusCheck = /^--- CONSENSUS CHECK/.test(msg.content);
          const isRoundMarker = /^--- Round \d+/.test(msg.content);

          if (isStartMarker || isEndMarker) {
            const phase = msg.content.match(/(DISCOVERY|RETROSPECTIVE)/)?.[1] || "";
            const isStart = isStartMarker;
            return (
              <div key={msg.id} className="flex items-center gap-3 px-6 py-3 my-2">
                <div className="flex-1 h-px" style={{ background: isStart ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)" }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full"
                  style={{
                    background: isStart ? "rgba(59,130,246,0.1)" : "rgba(34,197,94,0.1)",
                    color: isStart ? "#60a5fa" : "#4ade80",
                  }}>
                  {isStart ? `▶ ${phase}` : `✓ ${phase} COMPLETE`}
                </span>
                <div className="flex-1 h-px" style={{ background: isStart ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)" }} />
              </div>
            );
          }

          if (isConsensusCheck) {
            return (
              <div key={msg.id} className="flex items-center gap-3 px-6 py-2 my-1">
                <div className="flex-1 h-px" style={{ background: "rgba(245,158,11,0.3)" }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full"
                  style={{ background: "rgba(245,158,11,0.08)", color: "#fbbf24" }}>
                  🗳 Consensus Vote
                </span>
                <div className="flex-1 h-px" style={{ background: "rgba(245,158,11,0.3)" }} />
              </div>
            );
          }

          if (isRoundMarker) {
            return (
              <div key={msg.id} className="flex items-center gap-3 px-6 py-2 my-1">
                <div className="flex-1 h-px" style={{ background: "rgba(139,92,246,0.2)" }} />
                <span className="text-[11px] font-medium px-3 py-1 rounded-full"
                  style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa" }}>
                  {msg.content.split("\n")[0]}
                </span>
                <div className="flex-1 h-px" style={{ background: "rgba(139,92,246,0.2)" }} />
              </div>
            );
          }

          return <MessageBubble key={msg.id} msg={msg} agents={agents} onDelete={onDeleteMessage} />;
        })}
        {/* Typing indicators — only show agents actively typing in this channel */}
        {agents
          .filter((a) => a.status === "working" && a.currentChannelId === channel.id)
          .map((a) => (
            <TypingIndicator key={`typing-${a.id}`} agent={a} />
          ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose bar — memoized to prevent re-renders from message polling */}
      <ComposeBar channelId={channel.id} channelName={channel.name} onSend={onSend} />
    </div>
  );
}

const ComposeBar = memo(function ComposeBar({ channelId, channelName, onSend }: { channelId: string; channelName: string; onSend: (channelId: string, content: string) => void }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (!draft.trim()) return;
    onSend(channelId, draft.trim());
    setDraft("");
    inputRef.current?.focus();
  }, [draft, onSend, channelName]);

  return (
    <div className="px-4 py-3 border-t" style={{ borderColor: "#222228" }}>
      <div className="flex gap-3 items-center rounded-xl px-4 py-2.5" style={{ background: "#141417", border: "1px solid #222228" }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={`Message #${channelName}...`}
          className="flex-1 text-[13px] outline-none border-0 bg-transparent"
          style={{ color: "#ececef" }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim()}
          className="px-4 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-0 transition-colors"
          style={{ background: draft.trim() ? "#8b5cf6" : "#19191d", color: draft.trim() ? "#fff" : "#5c5c66" }}
        >
          Send
        </button>
      </div>
    </div>
  );
});
