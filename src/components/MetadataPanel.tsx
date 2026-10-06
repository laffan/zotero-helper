// The details panel picks what to show for the current selection: one
// item's record, a summary of several, a standalone file's facts, or —
// in Questions — the open conversation.
//
// With a selection it has tabs: Details (Summary for several items),
// Highlights when the selection has any, and Notes, always — with the
// entry's PDF button (Download / View / Close PDF) at the right end.
// While the PDF is open, the panel stays on that entry whatever the
// selection does.
import { useMemo } from "react";
import { isStandaloneAttachment } from "../lib/collections";
import { QUESTIONS, useStore, type MetaTab } from "../lib/store";
import { AttachmentPanel } from "./AttachmentPanel";
import { ChatPanel } from "./ChatPanel";
import { highlightGroups, HighlightsPanel } from "./HighlightsPanel";
import { ItemEditor } from "./ItemEditor";
import { NotesPanel } from "./NotesPanel";
import { PdfTabButton } from "./PdfTabButton";
import { SummaryView } from "./SummaryView";

export function MetadataPanel() {
  const selectedKeys = useStore((s) => s.selectedKeys);
  const items = useStore((s) => s.library.items);
  const collectionKey = useStore((s) => s.selectedCollection);
  const selectedChatId = useStore((s) => s.selectedChatId);
  const chats = useStore((s) => s.chats);
  const reading = useStore((s) => s.reading);
  const metaTab = useStore((s) => s.metaTab);
  const setMetaTab = useStore((s) => s.setMetaTab);
  const { metaOpen, setMetaOpen } = useStore();

  const selected = useMemo(() => {
    // An open PDF holds the panel on its entry whatever the selection does.
    const keys = reading ? [reading.itemKey] : selectedKeys;
    return items.filter((i) => keys.includes(i.key));
  }, [items, selectedKeys, reading]);

  const highlightCount = useMemo(
    () => highlightGroups(items, selected).reduce((n, g) => n + g.list.length, 0),
    [items, selected],
  );

  const chatMode =
    !reading && collectionKey === QUESTIONS && chats.some((c) => c.id === selectedChatId);

  // A remembered tab that has nothing to show falls back to Details.
  const tab: MetaTab = metaTab === "highlights" && highlightCount === 0 ? "details" : metaTab;

  let tabs: React.ReactNode = null;
  let content: React.ReactNode;
  if (!reading && collectionKey === QUESTIONS) {
    // Questions replaces the item list, so the panel follows it: the
    // open conversation, or the prompt to open one.
    const chat = chats.find((c) => c.id === selectedChatId);
    content = chat ? (
      <ChatPanel key={chat.id} chat={chat} />
    ) : (
      <div className="meta-empty">Select a conversation to continue it</div>
    );
  } else if (selected.length === 0) {
    content = <div className="meta-empty">Select an item to see its details</div>;
  } else {
    const one = selected.length === 1 ? selected[0] : null;
    const tabButton = (id: MetaTab, label: string) => (
      <button
        className={`meta-tab ${tab === id ? "active" : ""}`}
        onClick={() => setMetaTab(id)}
        role="tab"
        aria-selected={tab === id}
      >
        {label}
      </button>
    );
    tabs = (
      <div className="meta-tabs" role="tablist">
        {tabButton("details", one ? "Details" : "Summary")}
        {highlightCount > 0 && tabButton("highlights", `Highlights ${highlightCount}`)}
        {tabButton("notes", "Notes")}
        {one && <PdfTabButton item={one} />}
      </div>
    );
    if (tab === "highlights") {
      content = <HighlightsPanel items={selected} />;
    } else if (tab === "notes") {
      content = one ? (
        <NotesPanel key={one.key} item={one} />
      ) : (
        <div className="meta-empty">Select a single item to read its notes</div>
      );
    } else if (!one) {
      content = <SummaryView items={selected} />;
    } else {
      // A file with no parent entry has almost no metadata to edit — it
      // gets its own trimmed panel rather than a page of empty fields.
      content = isStandaloneAttachment(one) ? (
        <AttachmentPanel item={one} />
      ) : (
        <ItemEditor item={one} />
      );
    }
  }

  return (
    <>
      {metaOpen && <div className="drawer-scrim" onClick={() => setMetaOpen(false)} />}
      <aside
        className={`meta-panel ${metaOpen ? "open" : ""} ${chatMode ? "chat-mode" : ""} ${
          reading ? "notes-mode" : ""
        } ${tabs ? "tabbed" : ""}`}
      >
        {tabs}
        <div className="meta-content">{content}</div>
      </aside>
    </>
  );
}
