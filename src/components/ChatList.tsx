// The Questions folder's main-area list. One row per conversation:
// what the model called it, when it started, and what it was about —
// the three things you need to find a conversation again a week later.
import { removeChat } from "../lib/ai/chat";
import { formatTokens, formatUsd, modelLabel } from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { ChatIcon, TrashIcon } from "./Icons";
import { WorkTitles } from "./WorkTitles";

function started(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `Today ${time}`
    : `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}

function contextLine(chat: Chat): string {
  const n = chat.source.itemKeys.length;
  const depth = chat.source.depth === "full" ? "full text" : "abstracts";
  const scope =
    chat.source.kind === "folder"
      ? `Folder “${chat.source.label}” · ${n} item${n === 1 ? "" : "s"}`
      : chat.source.kind === "selection"
        ? `${n} selected item${n === 1 ? "" : "s"}`
        : chat.source.label;
  return `${scope} · ${depth}`;
}

function ChatRow({ chat, selected }: { chat: Chat; selected: boolean }) {
  const selectChat = useStore((s) => s.selectChat);
  const turns = chat.messages.filter((m) => m.role === "user").length;

  return (
    <div
      className={`chat-row ${selected ? "selected" : ""}`}
      onClick={() => selectChat(chat.id)}
      title="Open this conversation in the details panel"
    >
      <div className="chat-row-main">
        <div className="chat-row-title">
          <ChatIcon size={13} />
          <span>{chat.title}</span>
        </div>
        <div className="chat-row-context" title={contextLine(chat)}>
          {contextLine(chat)}
        </div>
        <WorkTitles source={chat.source} />
      </div>
      <div className="chat-row-meta">
        <span>{started(chat.createdMs)}</span>
        <span>
          {turns} question{turns === 1 ? "" : "s"} ·{" "}
          {formatTokens(chat.contextTokens)} · {formatUsd(chat.costUsd)}
        </span>
        <span className="chat-row-model">{modelLabel(chat.model)}</span>
      </div>
      <button
        className="icon-btn chat-row-delete"
        onClick={(e) => {
          e.stopPropagation();
          void removeChat(chat.id);
        }}
        aria-label={`Delete “${chat.title}”`}
        title="Delete this conversation"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

export function ChatList() {
  const chats = useStore((s) => s.chats);
  const selectedChatId = useStore((s) => s.selectedChatId);

  return (
    <section className="item-list chat-list">
      <div className="view-bar">
        <span className="chat-list-heading">Questions</span>
      </div>
      <div className="list-body">
        {chats.length === 0 ? (
          <div className="list-empty">
            No questions yet — open a folder, a selection, or an item and
            use <strong>Ask Abstracts</strong> or{" "}
            <strong>Ask Full Papers</strong>.
          </div>
        ) : (
          chats.map((c) => (
            <ChatRow key={c.id} chat={c} selected={c.id === selectedChatId} />
          ))
        )}
      </div>
      <footer className="list-footer">
        <span>
          {chats.length} conversation{chats.length === 1 ? "" : "s"}
          {chats.length > 0 &&
            ` · ${formatUsd(chats.reduce((sum, c) => sum + c.costUsd, 0))} spent`}
        </span>
      </footer>
    </section>
  );
}
