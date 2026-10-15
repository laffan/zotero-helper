// The right panel's conversations tab: the AI conversations (Questions)
// that include this entry — asked about it alone, or in a selection or
// folder it was part of — newest first, and the two ways to start one
// about it. A conversation opens here, in place of the list (with the
// way back above it), so it can be read beside the PDF; started from
// here with the PDF open, a new one opens here too (confirmAsk).
import { useMemo } from "react";
import { startAsk } from "../lib/ai/chat";
import { askTargetFor } from "../lib/ai/context";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { ChatPanel } from "./ChatPanel";
import { ChatRow } from "./ChatList";
import { ArrowLeftIcon } from "./Icons";

export function ItemChats({ item }: { item: ZItem }) {
  const allChats = useStore((s) => s.chats);
  const selectedChatId = useStore((s) => s.selectedChatId);
  const askPreparing = useStore((s) => s.askPreparing);
  const chats = useMemo(() => allChats.filter((c) => c.source.itemKeys.includes(item.key)), [allChats, item.key]);
  const open = chats.find((c) => c.id === selectedChatId);

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
        <button className="mini-btn" disabled={askPreparing} onClick={() => ask("abstracts")}>
          Ask Abstract
        </button>
        <button className="mini-btn" disabled={askPreparing} onClick={() => ask("full")}>
          Ask Full Paper
        </button>
      </div>
      <div className="item-chats-list">
        {chats.length === 0 ? (
          <div className="meta-empty">No conversations include this entry yet.</div>
        ) : (
          chats.map((c) => <ChatRow key={c.id} chat={c} selected={false} />)
        )}
      </div>
    </div>
  );
}
