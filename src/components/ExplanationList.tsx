// The reader's explanations (lib/ai/explain.ts), shown as what they are:
// a question and its answer, not conversations to carry on. Each is a
// box — the passage asked about as its head, the answer beneath — with
// an info button that shows the rest (when, which model, what it cost,
// with or without its context) and a quieter trash can. They are listed
// in the entry's conversations tab (ItemChats.tsx) and, across every
// document, in the sidebar's Explanations, where each also links back to
// its passage — the PDF opened at the page, the passage marked — as
// Words' entries do.
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { removeChat } from "../lib/ai/chat";
import { formatTokens, formatUsd, modelLabel } from "../lib/ai/models";
import { pdfAttachmentOf } from "../lib/collections";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { InfoIcon, TrashIcon } from "./Icons";
import { openReaderAt } from "./ReaderPane";

/** An explainer, not a conversation of Questions. */
export const isExplanation = (c: Chat) => c.mode === "explain";

function when(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** The passage asked about, and the answer (the latest, if asked again). */
function exchange(chat: Chat): { question: string; answer: string | null } {
  const q = chat.messages.find((m) => m.role === "user");
  const a = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return { question: q?.display ?? q?.content ?? chat.title, answer: a?.content ?? null };
}

/** The details the box leaves out, in a small popup under its info
 *  button; a press elsewhere or Escape closes it. */
function Details({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.(".explanation-info")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  const rows: [string, string][] = [
    ["Asked", when(chat.createdMs)],
    ["Model", modelLabel(chat.model)],
    ["Cost", formatUsd(chat.costUsd)],
    ["Context", chat.context ? `the work and its PDF (${formatTokens(chat.contextTokens)})` : "none"],
    ["From", chat.source.label],
  ];
  return (
    <div className="explanation-details" ref={ref} role="dialog" aria-label="About this explanation">
      {rows.map(([k, v]) => (
        <div key={k} className="explanation-details-row">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Where an explanation's passage was read, as a link back there. */
function SourceLink({ chat }: { chat: Chat }) {
  const items = useStore((s) => s.library.items);
  const itemKey = chat.source.itemKeys[0];
  const attKey = chat.passage?.attKey ?? pdfAttachmentOf(items, itemKey)?.key;
  if (!itemKey || !attKey) return <div className="explanation-source">{chat.source.label}</div>;
  const page = (chat.passage?.pageIndex ?? 0) + 1;
  const { question } = exchange(chat);
  return (
    <button
      className="link-btn explanation-source"
      onClick={() => openReaderAt(itemKey, attKey, page, { quote: chat.passage ? question : undefined })}
      title={`Open the PDF at the passage — “${question}”`}
    >
      {chat.source.itemTitles[0] || chat.source.label}, p. {page}
    </button>
  );
}

/** One explanation, open: `linked` adds the way back to its passage. */
export function ExplanationCard({ chat, linked = false }: { chat: Chat; linked?: boolean }) {
  const [info, setInfo] = useState(false);
  const { question, answer } = exchange(chat);
  return (
    <div className="explanation">
      <div className="explanation-head">
        <div className="explanation-question">{question}</div>
        <div className="explanation-actions">
          <button
            className={info ? "icon-btn explanation-info on" : "icon-btn explanation-info"}
            onClick={() => setInfo(!info)}
            aria-label="About this explanation"
            aria-expanded={info}
            title="When, which model, what it cost"
          >
            <InfoIcon size={13} />
          </button>
          <button
            className="icon-btn explanation-delete"
            onClick={() => void removeChat(chat.id)}
            aria-label="Delete this explanation"
            title="Delete this explanation"
          >
            <TrashIcon size={13} />
          </button>
        </div>
        {info && <Details chat={chat} onClose={() => setInfo(false)} />}
      </div>
      <div className="explanation-answer chat-md">
        {answer ? <Markdown remarkPlugins={[remarkGfm]}>{answer}</Markdown> : <em>No answer yet.</em>}
      </div>
      {linked && <SourceLink chat={chat} />}
    </div>
  );
}

/** The sidebar's Explanations: every explanation, newest first. */
export function ExplanationList() {
  const chats = useStore((s) => s.chats);
  const list = useMemo(
    () => chats.filter(isExplanation).sort((a, b) => b.createdMs - a.createdMs),
    [chats],
  );
  return (
    <section className="item-list explanation-list">
      <div className="view-bar">
        <span className="chat-list-heading">Explanations</span>
      </div>
      <div className="list-body">
        {list.length === 0 ? (
          <div className="list-empty">
            No explanations yet — select a passage in a PDF and use the sparkles over it.
          </div>
        ) : (
          list.map((c) => <ExplanationCard key={c.id} chat={c} linked />)
        )}
      </div>
      <footer className="list-footer">
        <span>
          {list.length} explanation{list.length === 1 ? "" : "s"}
          {list.length > 0 && ` · ${formatUsd(list.reduce((sum, c) => sum + c.costUsd, 0))} spent`}
        </span>
      </footer>
    </section>
  );
}
