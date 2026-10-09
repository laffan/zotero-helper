// The details panel picks what to show for the current selection: one
// item's record, a summary of several, a standalone file's facts, or —
// in Questions — the open conversation.
//
// With a selection it has tabs: Details (Summary for several items),
// Highlights when the selection has any, and Notes, always — with the
// entry's PDF button (Download / View / Close PDF) at the right end.
// While the PDF is open, the panel stays on that entry whatever the
// selection does — and once it is wider than SPLIT_WIDTH, Highlights
// and Notes become one tab with the two side by side.
import { useEffect, useMemo, useRef, useState } from "react";
import { isStandaloneAttachment } from "../lib/collections";
import { QUESTIONS, useStore, type MetaTab } from "../lib/store";
import { AttachmentPanel } from "./AttachmentPanel";
import { ChatPanel } from "./ChatPanel";
import { highlightGroups, HighlightsPanel } from "./HighlightsPanel";
import { ItemEditor } from "./ItemEditor";
import { NotesPanel } from "./NotesPanel";
import { PdfTabButton } from "./PdfTabButton";
import { SummaryView } from "./SummaryView";

/** Past this width (px) the open PDF's highlights and notes share the
 *  panel instead of taking turns. */
const SPLIT_WIDTH = 600;

/** Is the element wider than SPLIT_WIDTH? Follows it as it resizes. */
function useWiderThanSplit(ref: React.RefObject<HTMLElement>): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > SPLIT_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}

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
  const hidden = useStore((s) => s.metaHidden);
  const panelRef = useRef<HTMLElement>(null);
  const wide = useWiderThanSplit(panelRef);

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
  // Highlights beside the notes, under one tab — reading, with room.
  const split = Boolean(reading) && wide && highlightCount > 0;

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
    const tabButton = (id: MetaTab, label: string, active = tab === id) => (
      <button
        className={`meta-tab ${active ? "active" : ""}`}
        onClick={() => setMetaTab(id)}
        role="tab"
        aria-selected={active}
      >
        {label}
      </button>
    );
    tabs = (
      <div className="meta-tabs" role="tablist">
        {tabButton("details", one ? "Details" : "Summary")}
        {split ? (
          tabButton("notes", `Highlights ${highlightCount} & Notes`, tab !== "details")
        ) : (
          <>
            {highlightCount > 0 && tabButton("highlights", `Highlights ${highlightCount}`)}
            {tabButton("notes", "Notes")}
          </>
        )}
        {one && <PdfTabButton item={one} />}
      </div>
    );
    if (tab === "notes" || (split && tab === "highlights")) {
      // One wrapper either way, so the notes editor stays mounted (caret,
      // undo history) as the panel crosses SPLIT_WIDTH.
      content = one ? (
        <div className={split ? "meta-split" : "meta-single"}>
          {split ? (
            <div className="meta-split-hl">
              <HighlightsPanel items={selected} />
            </div>
          ) : null}
          <NotesPanel key={one.key} item={one} />
        </div>
      ) : (
        <div className="meta-empty">Select a single item to read its notes</div>
      );
    } else if (tab === "highlights") {
      content = <HighlightsPanel items={selected} />;
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
        ref={panelRef}
        className={`meta-panel ${metaOpen ? "open" : ""} ${chatMode ? "chat-mode" : ""} ${
          reading ? "notes-mode" : ""
        } ${tabs ? "tabbed" : ""} ${hidden ? "collapsed" : ""}`}
      >
        {tabs}
        <div className="meta-content">{content}</div>
      </aside>
    </>
  );
}
