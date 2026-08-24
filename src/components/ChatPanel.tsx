// The conversation itself, in the details panel. Beneath the input sit
// the two numbers that decide how you use this feature: what the chat
// has cost so far, and how long the works stay in the provider's prompt
// cache. Ask again inside that window and the papers are re-read at a
// tenth of the price; let it lapse and the next question pays for them
// in full again.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openInZotero } from "../lib/actions";
import { removeChat, sendChatMessage } from "../lib/ai/chat";
import {
  CITE_SCHEME,
  citationLabel,
  linkifyCitations,
  parseCiteHref,
} from "../lib/ai/citations";
import { shareConversation } from "../lib/ai/export";
import {
  CACHE_TTL_MS,
  formatTokens,
  formatUsd,
  modelLabel,
} from "../lib/ai/models";
import { pdfAttachmentOf } from "../lib/collections";
import { useStore } from "../lib/store";
import type { Chat, ChatSource } from "../lib/types";
import {
  ExternalIcon,
  EyeIcon,
  ShareIcon,
  Spinner,
  TrashIcon,
} from "./Icons";

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

/** The button a [[cite:W:P]] becomes: which page, and the two ways to
 *  go and look at it. */
function CitePill({
  href,
  source,
}: {
  href: string;
  source: ChatSource;
}) {
  const items = useStore((s) => s.library.items);
  const setModal = useStore((s) => s.setModal);
  const cite = parseCiteHref(href);
  if (!cite) return null;

  // A citation that named only a page is unambiguous when the chat
  // covers a single work, and guesswork when it doesn't.
  const index =
    cite.work ?? (source.itemKeys.length === 1 ? 1 : 0);
  const itemKey = source.itemKeys[index - 1];
  const title = source.itemTitles?.[index - 1] ?? "";
  const label = citationLabel(cite);

  // No work to resolve, or the work has no PDF any more: keep the
  // reference visible, just without buttons that would go nowhere.
  const att = itemKey ? pdfAttachmentOf(items, itemKey) : undefined;
  if (!itemKey || !att) {
    return (
      <span className="cite-pill cite-pill-dead" title={title || undefined}>
        {label}
      </span>
    );
  }

  return (
    <span className="cite-pill" title={title || undefined}>
      <span className="cite-label">{label}</span>
      <button
        onClick={() =>
          setModal({ kind: "pdfPage", itemKey, page: cite.page, title })
        }
        aria-label={`View page ${cite.page}`}
        title={`View page ${cite.page} here${title ? ` — ${title}` : ""}`}
      >
        <EyeIcon size={12} />
      </button>
      <button
        onClick={() =>
          void openInZotero(itemKey, att.key, undefined, cite.page)
        }
        aria-label={`Open page ${cite.page} in Zotero`}
        title={`Open in Zotero at page ${cite.page}`}
      >
        <ExternalIcon size={12} />
      </button>
    </span>
  );
}

/** Who said it is carried by the styling — the question sits in a box,
 *  the answer runs plain down the panel.
 *
 *  Answers render as Markdown (GitHub flavour, so tables and strike-
 *  through work): models write headings, lists and tables whether or not
 *  you ask, and a comparison of five papers is a table. The question is
 *  left as typed — nobody writes Markdown into a chat box on purpose,
 *  and an underscore in a title shouldn't turn into emphasis. */
const Bubble = memo(function Bubble({
  role,
  content,
  source,
}: {
  role: string;
  content: string;
  source: ChatSource;
}) {
  // Citations become links with a private scheme so the Markdown
  // pipeline carries them as real nodes, and the `a` override below
  // turns those back into pills.
  const md = useMemo(
    () => (role === "user" ? content : linkifyCitations(content)),
    [role, content],
  );
  return (
    <div className={`chat-msg chat-msg-${role}`}>
      {role === "user" ? (
        <div className="chat-msg-body">{content}</div>
      ) : (
        <div className="chat-msg-body chat-md">
          <Markdown
            remarkPlugins={[remarkGfm]}
            // react-markdown drops any URL whose scheme it doesn't
            // recognise, which would strip citations before they reach
            // the `a` override below. Let ours through and leave every
            // other link to the default sanitizer — the text is a
            // model's, so `javascript:` still has to be blocked.
            urlTransform={(url) =>
              url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url)
            }
            components={{
              // The panel is a narrow column; a wide table scrolls
              // inside its own box rather than stretching it.
              table: ({ children }) => (
                <div className="chat-md-table">
                  <table>{children}</table>
                </div>
              ),
              a: ({ href, children }) =>
                parseCiteHref(String(href ?? "")) ? (
                  <CitePill href={String(href)} source={source} />
                ) : (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
            }}
          >
            {md}
          </Markdown>
        </div>
      )}
    </div>
  );
});

export function ChatPanel({ chat }: { chat: Chat }) {
  const busy = useStore((s) => s.chatBusy) === chat.id;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

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
          <Bubble
            key={i}
            role={m.role}
            content={m.content}
            source={chat.source}
          />
        ))}
        {busy && (
          <div className="chat-msg chat-msg-assistant">
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
          <CacheCountdown chat={chat} />
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
