// The conversation itself, in the details panel. Beneath the input sit
// the two numbers that decide how you use this feature: what the chat
// has cost so far, and how long the works stay in the provider's prompt
// cache. Ask again inside that window and the papers are re-read at a
// tenth of the price; let it lapse and the next question pays for them
// in full again.
import { useEffect, useRef, useState } from "react";
import { sendChatMessage } from "../lib/ai/chat";
import { shareConversation } from "../lib/ai/export";
import {
  CACHE_TTL_MS,
  formatTokens,
  formatUsd,
  modelLabel,
} from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { ShareIcon, Spinner } from "./Icons";

/** mm:ss left on the provider's cache window, or null once it's gone. */
function useCacheCountdown(chat: Chat): string | null {
  const ttl = CACHE_TTL_MS[chat.service] ?? 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!chat.lastCallMs || !ttl) return;
    const expiry = chat.lastCallMs + ttl;
    if (Date.now() >= expiry) {
      setNow(Date.now());
      return;
    }
    const t = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= expiry) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [chat.lastCallMs, ttl]);

  if (!chat.lastCallMs || !ttl) return null;
  const left = chat.lastCallMs + ttl - now;
  if (left <= 0) return null;
  const secs = Math.ceil(left / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function Bubble({ role, content }: { role: string; content: string }) {
  return (
    <div className={`chat-msg chat-msg-${role}`}>
      <span className="chat-msg-role">{role === "user" ? "You" : "Model"}</span>
      <div className="chat-msg-body">{content}</div>
    </div>
  );
}

export function ChatPanel({ chat }: { chat: Chat }) {
  const busy = useStore((s) => s.chatBusy) === chat.id;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const countdown = useCacheCountdown(chat);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    try {
      await sendChatMessage(chat.id, text);
    } catch (e) {
      setError(String(e));
      // Give the question back so it isn't retyped.
      setDraft(text);
    }
  };

  const share = () => {
    const r = shareRef.current?.getBoundingClientRect();
    void shareConversation(
      chat,
      r
        ? { x: r.left + r.width / 2, y: r.top }
        : { x: window.innerWidth / 2, y: 60 },
    );
  };

  const n = chat.source.itemKeys.length;

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="chat-head-title">{chat.title}</div>
        <div className="chat-head-sub">
          {n} work{n === 1 ? "" : "s"} ·{" "}
          {chat.source.depth === "full" ? "full text" : "abstracts"} ·{" "}
          {formatTokens(chat.contextTokens)} tokens · {modelLabel(chat.model)}
        </div>
        {chat.source.missing.length > 0 && (
          <div
            className="chat-head-warn"
            title={chat.source.missing.join("; ")}
          >
            {chat.source.missing.length} work
            {chat.source.missing.length === 1 ? "" : "s"} contributed nothing
          </div>
        )}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            The works are loaded. Ask your first question below.
          </div>
        )}
        {chat.messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {busy && (
          <div className="chat-msg chat-msg-assistant">
            <span className="chat-msg-role">Model</span>
            <div className="chat-msg-body chat-thinking">
              <Spinner size={13} /> reading…
            </div>
          </div>
        )}
        {error && <div className="error-msg">{error}</div>}
      </div>

      <div className="chat-compose">
        <textarea
          rows={3}
          value={draft}
          placeholder={busy ? "Waiting for the reply…" : "Ask a question…"}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-meter">
          <span title="Everything this conversation has cost so far">
            {formatUsd(chat.costUsd)} spent
          </span>
          {/* Nothing has been cached until the first request goes out,
              so a fresh chat says nothing about a cache at all. */}
          {chat.lastCallMs > 0 && (
            <span
              className={countdown ? "chat-cache-live" : "chat-cache-cold"}
              title={
                countdown
                  ? `The works stay cached for ${countdown} more — asking again before then re-reads them at the cached rate`
                  : "The cache has lapsed: the next question pays full price for the works again"
              }
            >
              {countdown ? `cache ${countdown}` : "cache lapsed"}
            </span>
          )}
          <button
            className="tool-btn accent chat-send"
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
          >
            {busy ? <Spinner size={13} /> : null} Send
          </button>
        </div>
        <div className="chat-actions">
          <button
            className="tool-btn"
            ref={shareRef}
            onClick={share}
            title="Export the whole conversation, source material included, as Markdown"
          >
            <ShareIcon size={13} /> Share Conversation
          </button>
        </div>
      </div>
    </div>
  );
}
