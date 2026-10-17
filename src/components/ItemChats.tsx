// The right panel's conversations tab (shown with an AI service
// connected): the AI conversations about this entry alone, newest
// first, and the two ways to start one. Above them, the conversations
// it was only part of (a selection or a folder asked about) are listed
// as links, which open in Questions, the main conversations window.
// The passages the reader has had explained (lib/ai/explain.ts) are
// listed apart, under Explanations: a different kind of conversation.
// A conversation about the entry opens here, in place of the list (with
// the way back above it), to be read beside the PDF; one started from
// here with the PDF open opens here too (confirmAsk), and so does any
// conversation whose citation opened the PDF (ChatPanel's eye).
import { useMemo } from "react";
import { startAsk } from "../lib/ai/chat";
import { askTargetFor } from "../lib/ai/context";
import { closeReader } from "../lib/notes";
import { QUESTIONS, useStore } from "../lib/store";
import type { Chat, ZItem } from "../lib/types";
import { ChatPanel } from "./ChatPanel";
import { ChatRow } from "./ChatList";
import { ArrowLeftIcon, ChatIcon, PdfIcon, QuestionIcon, Sparkles } from "./Icons";

/** A conversation about this entry alone (not a selection or folder). */
export const isAbout = (c: Chat, itemKey: string) =>
  c.source.kind === "item" && c.source.itemKeys.length === 1 && c.source.itemKeys[0] === itemKey;

/** Open a conversation in Questions — leaving the PDF, if one is open. */
function openInQuestions(id: string): void {
  if (useStore.getState().reading) closeReader();
  const s = useStore.getState();
  s.selectCollection(QUESTIONS);
  s.selectChat(id);
}

export function ItemChats({ item }: { item: ZItem }) {
  const allChats = useStore((s) => s.chats);
  const selectedChatId = useStore((s) => s.selectedChatId);
  const askPreparing = useStore((s) => s.askPreparing);
  const mine = useMemo(() => allChats.filter((c) => isAbout(c, item.key)), [allChats, item.key]);
  const own = mine.filter((c) => c.mode !== "explain");
  const explained = mine.filter((c) => c.mode === "explain");
  const shared = useMemo(
    () => allChats.filter((c) => !isAbout(c, item.key) && c.source.itemKeys.includes(item.key)),
    [allChats, item.key],
  );
  // The open conversation, if it covers this entry: one about it alone,
  // or a wider one whose citation opened this PDF (the conversation
  // stays in front beside the page it cited).
  const open = allChats.find((c) => c.id === selectedChatId && c.source.itemKeys.includes(item.key));

  if (open) {
    return (
      <div className="item-chats">
        <button className="link-btn item-chats-back" onClick={() => useStore.getState().selectChat(null)}>
          <ArrowLeftIcon size={12} /> Conversations
        </button>
        <ChatPanel key={open.id} chat={open} />
      </div>
    );
  }

  const ask = (depth: "abstracts" | "full") => {
    const s = useStore.getState();
    const target = askTargetFor(s.library.items, s.library.collections, s.selectedCollection, [item.key]);
    void startAsk(target, depth);
  };

  return (
    <div className="item-chats">
      <div className="item-chats-start">
        <button className="meta-tab-action" disabled={askPreparing} onClick={() => ask("abstracts")}>
          <Sparkles size={12} /> Ask Abstract
        </button>
        <button className="meta-tab-action" disabled={askPreparing} onClick={() => ask("full")}>
          <PdfIcon size={12} /> Ask Full Paper
        </button>
      </div>
      {shared.length > 0 && (
        <div className="item-chats-shared">
          <div className="item-chats-shared-head">Also part of</div>
          {shared.map((c) => (
            <button
              key={c.id}
              className="link-btn item-chats-link"
              onClick={() => openInQuestions(c.id)}
              title={`Open in Questions — ${c.source.label}`}
            >
              <ChatIcon size={11} />
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      )}
      <div className="item-chats-list">
        {own.length === 0 ? (
          <div className="meta-empty">No conversations about this entry yet.</div>
        ) : (
          own.map((c) => <ChatRow key={c.id} chat={c} selected={false} />)
        )}
        {explained.length > 0 && (
          <>
            <div className="item-chats-section">
              <QuestionIcon size={11} /> Explanations
            </div>
            {explained.map((c) => (
              <ChatRow key={c.id} chat={c} selected={false} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
