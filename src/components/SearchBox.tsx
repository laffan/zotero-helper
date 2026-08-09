// The toolbar's search field. The magnifier opens a menu of search
// modes — which slice of the metadata a query runs against — and the
// active mode's label doubles as the field's placeholder, so the box
// always says what it will search. "Search Date Range" is the odd one
// out: it swaps the text field for two year boxes.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { SEARCH_MODES } from "../lib/types";
import { CheckIcon, SearchIcon } from "./Icons";
import { ToolbarMenu } from "./ToolbarMenu";

const MENU_WIDTH = 210;

export function SearchBox() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const searchMode = useStore((s) => s.searchMode);
  const setSearchMode = useStore((s) => s.setSearchMode);
  const searchDates = useStore((s) => s.searchDates);
  const setSearchDates = useStore((s) => s.setSearchDates);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      // The menu is portaled to document.body — a mousedown inside it
      // must not close it before the item's click handler fires.
      if ((e.target as Element).closest?.(".filter-pop")) return;
      if (!anchorRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const active =
    SEARCH_MODES.find((m) => m.id === searchMode) ?? SEARCH_MODES[0];

  return (
    <div className="toolbar-search">
      <div className="filter-anchor search-mode" ref={anchorRef}>
        <button
          className="icon-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          title={`${active.label} — click to change what is searched`}
          aria-label="Search mode"
          aria-expanded={menuOpen}
        >
          <SearchIcon />
        </button>
        {menuOpen && (
          <ToolbarMenu anchorRef={anchorRef} width={MENU_WIDTH}>
            {SEARCH_MODES.map((m) => (
              <button
                key={m.id}
                className={`menu-item mode-item ${m.id === searchMode ? "on" : ""}`}
                onClick={() => {
                  setSearchMode(m.id);
                  setMenuOpen(false);
                }}
              >
                <span className="mode-check">
                  {m.id === searchMode && <CheckIcon size={12} />}
                </span>
                <strong>{m.label}</strong>
              </button>
            ))}
          </ToolbarMenu>
        )}
      </div>
      {searchMode === "date" ? (
        <div className="search-dates">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="From"
            value={searchDates.from}
            onChange={(e) => setSearchDates({ from: e.target.value })}
            aria-label="Search from year"
          />
          <span aria-hidden="true">–</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="To"
            value={searchDates.to}
            onChange={(e) => setSearchDates({ to: e.target.value })}
            aria-label="Search to year"
          />
        </div>
      ) : (
        <input
          type="search"
          placeholder={active.label}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={active.label}
        />
      )}
    </div>
  );
}
