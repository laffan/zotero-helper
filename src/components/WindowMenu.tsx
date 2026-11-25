// The header's New Window button (between night vision and Settings)
// and its menu (lib/windows/): Duplicate window — another showing what
// this one does, the PDF open at the same place; Fresh window — the app
// as it opens; and a search of the library's PDFs, one picked opening in
// a window of its own. In a plain browser there are no windows to open,
// and no button.
import { useEffect, useMemo, useRef, useState } from "react";
import { creatorSummary, itemTitle, pdfAttachmentOf, yearOf } from "../lib/collections";
import { useSearchResults } from "../lib/search";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { canOpenWindows, openWindow, snapshotWindow } from "../lib/windows";
import { CloseIcon, NewWindowIcon, PdfIcon, SearchIcon } from "./Icons";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";

/** Results listed at most. */
const SHOWN = 8;
const NO_DATES = { from: "", to: "" };

export function WindowMenu() {
  const menu = useDropdown();
  if (!canOpenWindows) return null;
  const close = () => menu.setOpen(false);
  return (
    <div className="filter-anchor" ref={menu.ref}>
      <button
        className={`icon-btn ${menu.open ? "active" : ""}`}
        onClick={() => menu.setOpen(!menu.open)}
        title="New window"
        aria-label="New window"
        aria-expanded={menu.open}
      >
        <NewWindowIcon />
      </button>
      {menu.open && (
        <ToolbarMenu anchorRef={menu.ref} width={320}>
          <button
            className="menu-item"
            onClick={() => {
              const snapshot = snapshotWindow();
              close();
              void openWindow({ kind: "duplicate", snapshot });
            }}
          >
            <strong>Duplicate window</strong>
            <span>Another window showing what this one shows</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              close();
              void openWindow(null);
            }}
          >
            <strong>Fresh window</strong>
            <span>The library, as the app opens</span>
          </button>
          <span className="menu-sep" />
          <WindowSearch onOpen={close} />
        </ToolbarMenu>
      )}
    </div>
  );
}

/** The menu's search: the library's entries with a PDF, by title,
 *  author, year and the rest the list's search reads; one picked (a
 *  click, or Enter on the one marked) opens in a new window. Built only
 *  while the menu is open, since it indexes the library. */
function WindowSearch({ onOpen }: { onOpen: () => void }) {
  const items = useStore((s) => s.library.items);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const keys = useSearchResults(items, query, "all", NO_DATES);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const found: ZItem[] = [];
  for (const k of keys ?? []) {
    const item = byKey.get(k);
    if (item && pdfAttachmentOf(items, k)) found.push(item);
    if (found.length === SHOWN) break;
  }
  const marked = Math.min(at, Math.max(0, found.length - 1));
  useEffect(() => setAt(0), [query]);
  // Typed into at once with a keyboard and pointer; on a touch screen
  // that would bring up the on-screen keyboard for Duplicate too.
  useEffect(() => {
    if (matchMedia("(hover: hover)").matches) input.current?.focus({ preventScroll: true });
  }, []);

  const open = (itemKey: string) => {
    onOpen();
    void openWindow({ kind: "open", itemKey });
  };

  return (
    <div className="window-search">
      <div className="hl-search window-search-field">
        {query ? (
          <button
            className="icon-btn hl-search-clear"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            title="Clear the search"
            aria-label="Clear the search"
          >
            <CloseIcon size={13} />
          </button>
        ) : (
          <span className="hl-search-glyph" aria-hidden="true">
            <SearchIcon />
          </span>
        )}
        <input
          ref={input}
          type="text"
          placeholder="Open a PDF in a new window…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (found.length) setAt((marked + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length);
            } else if (e.key === "Enter" && found[marked]) {
              e.preventDefault();
              open(found[marked].key);
            }
          }}
          aria-label="Search for a PDF to open in a new window"
        />
      </div>
      {query.trim() && (
        <div className="window-search-results" role="listbox">
          {found.length === 0 && <div className="window-search-none">No PDFs match</div>}
          {found.map((item, i) => {
            const by = [creatorSummary(item), yearOf(item)].filter(Boolean).join(", ");
            return (
              <button
                key={item.key}
                className={`window-search-hit ${i === marked ? "current" : ""}`}
                role="option"
                aria-selected={i === marked}
                onPointerEnter={() => setAt(i)}
                onClick={() => open(item.key)}
              >
                <PdfIcon size={14} />
                <span className="window-search-text">
                  <span className="window-search-title">{itemTitle(item)}</span>
                  {by && <span className="window-search-by">{by}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
