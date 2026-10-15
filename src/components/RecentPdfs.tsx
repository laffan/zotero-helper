// The open PDF's name in the reading toolbar, which is also the way to
// the other PDFs read lately: a press lists the last 20 opened (the
// same list as the sidebar's Recent, lib/recent.ts), each named as the
// toolbar names the open one. Picking one opens it in place of this
// one; the × beside it takes it off the list until it is opened again.
// The first five open from anywhere with ⌘1–⌘5 (lib/shortcuts/), and
// say so beside their names.
import { creatorSummary, itemTitle, yearOf } from "../lib/collections";
import { pushDirtyNotes, readItem } from "../lib/notes";
import { forgetOpened, otherRecent, useRecent } from "../lib/recent";
import { bindingsOf, formatCombo, useShortcuts } from "../lib/shortcuts/bindings";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { ChevronDown, CloseIcon } from "./Icons";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";

const SHOWN = 20;

/** An entry's title over its byline (authors, year). */
function DocName({ item }: { item: ZItem }) {
  const byline = [creatorSummary(item), yearOf(item)].filter(Boolean).join(", ");
  return (
    <span className="toolbar-doc-text">
      <span className="toolbar-doc-title">{itemTitle(item)}</span>
      {byline && <span className="toolbar-doc-byline">{byline}</span>}
    </span>
  );
}

export function ReadingTitle({ itemKey }: { itemKey: string }) {
  const items = useStore((s) => s.library.items);
  const opened = useRecent((s) => s.opened);
  const dd = useDropdown();
  // The first five carry their ⌘1–⌘5, as currently bound.
  const custom = useShortcuts((s) => s.custom);
  const keyOf = (n: number) => {
    const combo = bindingsOf(`recent${n}`, custom)[0];
    return combo ? formatCombo(combo) : "";
  };
  const item = items.find((i) => i.key === itemKey);
  if (!item) return null;

  // The others, newest first, that are still in the library.
  const byKey = new Map(items.map((i) => [i.key, i]));
  const others = otherRecent(opened, (k) => byKey.has(k), itemKey)
    .slice(0, SHOWN)
    .map((k) => byKey.get(k)!);

  const open = (key: string) => {
    dd.setOpen(false);
    void pushDirtyNotes();
    void readItem(key);
  };

  return (
    <div className="toolbar-doc-anchor" ref={dd.ref}>
      <button
        className={`toolbar-doc ${dd.open ? "open" : ""}`}
        onClick={() => dd.setOpen(!dd.open)}
        title={`${itemTitle(item)} — recent PDFs`}
        aria-haspopup="menu"
        aria-expanded={dd.open}
      >
        <DocName item={item} />
        <ChevronDown size={12} />
      </button>
      {dd.open && (
        <ToolbarMenu anchorRef={dd.ref} width={380}>
          {others.length === 0 && <div className="recent-pdfs-empty">No other PDFs opened lately.</div>}
          <div className="recent-pdfs-list" role="menu">
            {others.map((it, i) => (
              <div className="recent-pdf" key={it.key}>
                <button className="recent-pdf-open" role="menuitem" onClick={() => open(it.key)}>
                  <DocName item={it} />
                  {i < 5 && keyOf(i + 1) && <span className="recent-pdf-key">{keyOf(i + 1)}</span>}
                </button>
                <button
                  className="recent-pdf-remove"
                  onClick={() => forgetOpened(it.key)}
                  title="Take off this list (opening it again puts it back)"
                  aria-label={`Remove “${itemTitle(it)}” from recent PDFs`}
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        </ToolbarMenu>
      )}
    </div>
  );
}
