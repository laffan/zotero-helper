// The details panel picks what to show for the current selection: one
// item's record, a summary of several, a standalone file's facts, or —
// in Questions — the open conversation.
import { useMemo } from "react";
import { isStandaloneAttachment } from "../lib/collections";
import { QUESTIONS, useStore } from "../lib/store";
import { AttachmentPanel } from "./AttachmentPanel";
import { ChatPanel } from "./ChatPanel";
import { ItemEditor } from "./ItemEditor";
import { SummaryView } from "./SummaryView";

export function MetadataPanel() {
  const selectedKeys = useStore((s) => s.selectedKeys);
  const items = useStore((s) => s.library.items);
  const collectionKey = useStore((s) => s.selectedCollection);
  const selectedChatId = useStore((s) => s.selectedChatId);
  const chats = useStore((s) => s.chats);
  const { metaOpen, setMetaOpen } = useStore();

  const selected = useMemo(
    () => items.filter((i) => selectedKeys.includes(i.key)),
    [items, selectedKeys],
  );

  const chatMode =
    collectionKey === QUESTIONS && chats.some((c) => c.id === selectedChatId);

  let content: React.ReactNode;
  if (collectionKey === QUESTIONS) {
    // Questions replaces the item list, so the panel follows it: the
    // open conversation, or the prompt to open one.
    const chat = chats.find((c) => c.id === selectedChatId);
    content = chat ? (
      <ChatPanel key={chat.id} chat={chat} />
    ) : (
      <div className="meta-empty">Select a conversation to continue it</div>
    );
  } else if (selected.length === 0) {
    content = (
      <div className="meta-empty">Select an item to see its details</div>
    );
  } else if (selected.length === 1) {
    // A file with no parent entry has almost no metadata to edit — it
    // gets its own trimmed panel rather than a page of empty fields.
    content = isStandaloneAttachment(selected[0]) ? (
      <AttachmentPanel item={selected[0]} />
    ) : (
      <ItemEditor item={selected[0]} />
    );
  } else {
    content = <SummaryView items={selected} />;
  }

  return (
    <>
      {metaOpen && (
        <div className="drawer-scrim" onClick={() => setMetaOpen(false)} />
      )}
      <aside
        className={`meta-panel ${metaOpen ? "open" : ""} ${
          chatMode ? "chat-mode" : ""
        }`}
      >
        {content}
      </aside>
    </>
  );
}
