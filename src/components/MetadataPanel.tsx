// The details panel picks what to show for the current selection: one
// item's record, a summary of several, a standalone file's facts, or —
// in Questions — the open conversation.
//
// With a selection it has tabs: Details (Summary for several items),
// Highlights when the selection has any (or bookmarks), Post-its when it
// has any (PostItsPanel.tsx), Notes, always,
// and — for one entry, with an AI service connected — its AI
// conversations; the entry's PDF button (Download / View / Close PDF)
// sits at the right end.
// While the PDF is open, the panel stays on that entry whatever the
// selection does — and once it is wider than MAP_WIDTH, the Highlights
// tab shows the Highlight Map (HighlightMap.tsx) in place of the list.
import { useEffect, useMemo, useRef, useState } from "react";
import { useBookmarks } from "../lib/bookmarks";
import { aiConnected } from "../lib/ai/models";
import { isStandaloneAttachment } from "../lib/collections";
import { onPaneResized, paneResizing } from "../lib/dragGesture";
import { EXPLANATIONS, QUESTIONS, useStore, type MetaTab } from "../lib/store";
import { WORDS } from "../lib/words";
import { AttachmentPanel } from "./AttachmentPanel";
import { ChatPanel } from "./ChatPanel";
import { highlightGroups, HighlightsPanel } from "./HighlightsPanel";
import { ChatIcon } from "./Icons";
import { isAbout, ItemChats } from "./ItemChats";
import { ItemEditor } from "./ItemEditor";
import { NotesPanel } from "./NotesPanel";
import { PdfTabButton } from "./PdfTabButton";
import { postItGroups, PostItsPanel } from "./PostItsPanel";
import { SummaryView } from "./SummaryView";

/** Past this width (px) the open PDF's highlights are a map instead of
 *  a list. */
const MAP_WIDTH = 600;

/** Is the element wider than MAP_WIDTH? Follows it as it resizes — once
 *  a pane's edge being dragged is let go, so a drag back and forth over
 *  the width doesn't build the map and take it down again each time. */
function useWide(ref: React.RefObject<HTMLElement>): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (!paneResizing()) setWide(el.clientWidth > MAP_WIDTH);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const off = onPaneResized(check);
    return () => {
      ro.disconnect();
      off();
    };
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
  const wide = useWide(panelRef);

  const selected = useMemo(() => {
    // An open PDF holds the panel on its entry whatever the selection does.
    const keys = reading ? [reading.itemKey] : selectedKeys;
    return items.filter((i) => keys.includes(i.key));
  }, [items, selectedKeys, reading]);

  const bookmarks = useBookmarks((s) => s.list);
  // Highlights and bookmarks: either gives the selection a Highlights tab.
  const highlightCount = useMemo(
    () => highlightGroups(items, selected, bookmarks).reduce((n, g) => n + g.list.length, 0),
    [items, selected, bookmarks],
  );
  const postItCount = useMemo(
    () => postItGroups(items, selected).reduce((n, g) => n + g.list.length, 0),
    [items, selected],
  );

  const chatMode =
    !reading && collectionKey === QUESTIONS && chats.some((c) => c.id === selectedChatId);

  const aiOn = useStore((s) => aiConnected(s.settings));
  // The tab counts the conversations about this entry alone.
  const chatCount = useStore((s) =>
    selected.length === 1 ? s.chats.filter((c) => isAbout(c, selected[0].key)).length : 0,
  );
  // A tab that has nothing to show falls back to Details — or, for a
  // PDF with no highlights (which opens on Highlights) or post-its, to
  // its notes.
  const tab: MetaTab =
    (metaTab === "highlights" && highlightCount === 0) || (metaTab === "postits" && postItCount === 0)
      ? reading
        ? "notes"
        : "details"
      : metaTab === "chats" && !(aiOn && selected.length === 1)
        ? "details"
        : metaTab;
  // The Highlight Map in place of the list — reading, with room.
  const map = Boolean(reading) && wide && highlightCount > 0;

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
  } else if (!reading && collectionKey === WORDS) {
    content = <div className="meta-empty">A word's source opens its PDF at the page it was read on</div>;
  } else if (!reading && collectionKey === EXPLANATIONS) {
    content = <div className="meta-empty">An explanation's source opens its PDF at the passage</div>;
  } else if (selected.length === 0) {
    content = <div className="meta-empty">Select an item to see its details</div>;
  } else {
    const one = selected.length === 1 ? selected[0] : null;
    const tabButton = (id: MetaTab, label: React.ReactNode, active = tab === id, title?: string) => (
      <button
        className={`meta-tab ${active ? "active" : ""}`}
        onClick={() => setMetaTab(id)}
        role="tab"
        aria-selected={active}
        title={title}
      >
        {label}
      </button>
    );
    tabs = (
      <div className="meta-tabs" role="tablist">
        {tabButton("details", one ? "Details" : "Summary")}
        {highlightCount > 0 && tabButton("highlights", `${map ? "Highlight Map" : "Highlights"} ${highlightCount}`)}
        {postItCount > 0 && tabButton("postits", `Post-its ${postItCount}`)}
        {tabButton("notes", "Notes")}
        {one && aiOn &&
          tabButton(
            "chats",
            <span className="meta-tab-icon">
              <ChatIcon size={13} />
              {chatCount > 0 && chatCount}
            </span>,
            tab === "chats",
            "AI conversations about this entry",
          )}
        {one && <PdfTabButton item={one} />}
      </div>
    );
    if (tab === "notes") {
      content = one ? (
        <div className="meta-single">
          <NotesPanel key={one.key} item={one} />
        </div>
      ) : (
        <div className="meta-empty">Select a single item to read its notes</div>
      );
    } else if (tab === "chats" && one) {
      content = <ItemChats item={one} />;
    } else if (tab === "highlights") {
      content = <HighlightsPanel items={selected} map={map} />;
    } else if (tab === "postits") {
      content = <PostItsPanel items={selected} />;
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
