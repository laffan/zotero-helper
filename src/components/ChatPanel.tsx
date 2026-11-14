// The conversation itself, in the details panel. Its head says what it
// is about and, on a quieter line, when it began, how many questions it
// has had, the size of the works it read, what it has cost and which
// model answers (the list of conversations leaves those out). Beneath
// the input sit
// the two numbers that decide how you use this feature: what the chat
// has cost so far, and how long the works stay in the provider's prompt
// cache. Ask again inside that window and the papers are re-read at a
// tenth of the price; let it lapse and the next question pays for them
// in full again. The transcript is the first column of a strip
// (ThreadStrip.tsx): a passage of an answer selected and asked about
// opens a column to its right, which can be carried on from its own
// box, as this one is from the one below.
import { useEffect, useRef, useState } from "react";
import { removeChat, sendChatMessage } from "../lib/ai/chat";
import { depthLabel } from "../lib/ai/context";
import { shareConversation } from "../lib/ai/export";
import {
  CACHE_TTL_MS,
  formatTokens,
  formatUsd,
  modelLabel,
} from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { ShareIcon, Spinner, TrashIcon } from "./Icons";
import { started } from "./ChatList";
import { followRoot, ThreadStrip } from "./ThreadStrip";
import { WorkTitles } from "./WorkTitles";

/** mm:ss left on the provider's cache window, or null once it's gone.
 *
 *  Its own component on purpose: it re-renders every second, and if that
 *  re-render reached the transcript it would rebuild the rendered
 *  Markdown — snapping any table the reader had scrolled sideways back
 *  to its first column, once a second. */
function CacheCountdown({ chat }: { chat: Chat }) {
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

  // Nothing has been cached until the first request goes out, so a
  // fresh chat says nothing about a cache at all.
  if (!chat.lastCallMs || !ttl) return null;
  const left = chat.lastCallMs + ttl - now;
  const secs = Math.max(0, Math.ceil(left / 1000));
  const countdown =
    left > 0
      ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
      : null;

  return (
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
  );
}

export function ChatPanel({ chat }: { chat: Chat }) {
  const busy = useStore((s) => s.chatBusy) === chat.id;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

  // Follow the conversation as it grows: its own column, to its foot.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) followRoot(el);
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
  const turns = chat.messages.filter((m) => m.role === "user").length;

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="chat-head-title">{chat.title}</div>
        <div className="chat-head-sub">
          {n} work{n === 1 ? "" : "s"} · {chat.mode === "explain" ? "explainer" : depthLabel(chat.source)}
        </div>
        <div className="chat-head-meta">
          {started(chat.createdMs)} · {turns} question{turns === 1 ? "" : "s"} · {formatTokens(chat.contextTokens)} tokens ·{" "}
          {formatUsd(chat.costUsd)} · {modelLabel(chat.model)}
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
        <WorkTitles source={chat.source} />
      </div>

      {/* The conversation, and to its right the columns of what was
          asked about its answers (ThreadStrip.tsx). */}
      <ThreadStrip
        chat={chat}
        continuable
        scrollRef={scrollRef}
        rootBefore={
          chat.messages.length === 0 && (
            <div className="chat-empty">
              The works are loaded. Ask your first question below.
            </div>
          )
        }
        rootAfter={
          <>
            {busy && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-body chat-thinking">
                  <Spinner size={13} /> reading…
                </div>
              </div>
            )}
            {error && <div className="error-msg">{error}</div>}
          </>
        }
      />

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
          {/* An explainer sends a page, not the papers: nothing worth
              timing the cache for. */}
          {chat.mode !== "explain" && <CacheCountdown chat={chat} />}
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
          {/* Click twice: a conversation costs real money to produce
              and there is no undo. */}
          <button
            className={`tool-btn ${confirmDelete ? "danger" : ""}`}
            disabled={busy}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              setConfirmDelete(false);
              void removeChat(chat.id);
            }}
            title={
              confirmDelete
                ? "Click again to delete this conversation"
                : "Delete this conversation"
            }
          >
            <TrashIcon size={13} />{" "}
            {confirmDelete ? "Click to confirm" : "Delete Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}
