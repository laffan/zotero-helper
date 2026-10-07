// The toolbar's search field while a PDF is open: it finds words in
// that PDF instead of searching the library. Typing searches (after a
// short pause) and opens a list of the matches — each with its page and
// a few lines of the text around it — where a click shows that match.
// Enter / ⇧Enter and the arrows step through the matches, the ✕ that
// replaces the magnifier (or Escape) clears, and ⌘F comes back here.
import { useEffect, useRef, useState } from "react";
import type { SearchStatus } from "../pdfviewer/search";
import { ChevronDown, ChevronUp, CloseIcon, SearchIcon } from "./Icons";
import { goToReaderSearchHit, searchReader, stepReaderSearch } from "./ReaderPane";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";

const DEBOUNCE_MS = 250;
/** Matches listed at a time; "Show more matches" adds as many again. */
const PAGE = 100;

export function PdfSearchBox() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [shown, setShown] = useState(PAGE);
  const timer = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useDropdown();
  const listEl = useRef<HTMLDivElement>(null);

  const run = (q: string) => {
    window.clearTimeout(timer.current);
    setShown(PAGE);
    searchReader(q, setStatus);
  };

  const clear = () => {
    setQuery("");
    run("");
    list.setOpen(false);
    input.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Keep the current match in sight as Enter steps through the list.
  const current = status?.current ?? 0;
  useEffect(() => {
    if (!list.open || !current) return;
    listEl.current
      ?.querySelector(`[data-hit="${current - 1}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, list.open]);

  // A query the viewer hasn't searched yet (still being typed, or typed
  // before the PDF finished opening) is searched rather than stepped.
  const step = (dir: 1 | -1) => {
    if (status?.query !== query.trim()) run(query);
    else stepReaderSearch(dir);
  };

  const label = !status?.query
    ? ""
    : status.total
      ? `${status.current}/${status.total}${status.done ? "" : "+"}`
      : status.done
        ? "No matches"
        : "…";

  const hits = status?.query ? status.hits : [];
  const showList = list.open && hits.length > 0;

  return (
    <div className="toolbar-search pdf-search" ref={list.ref}>
      {query ? (
        <button
          className="icon-btn pdf-search-clear"
          onClick={clear}
          title="Clear the search"
          aria-label="Clear the search"
        >
          <CloseIcon size={13} />
        </button>
      ) : (
        <span className="pdf-search-glyph" aria-hidden="true">
          <SearchIcon />
        </span>
      )}
      <input
        ref={input}
        type="text"
        placeholder="Search this PDF"
        value={query}
        onFocus={() => list.setOpen(true)}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          list.setOpen(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => run(q), DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            if (list.open && hits.length) list.setOpen(false);
            else clear();
          }
        }}
        aria-label="Search this PDF"
        aria-expanded={showList}
      />
      {label && <span className="pdf-search-count">{label}</span>}
      <button
        className="icon-btn pdf-search-step"
        onClick={() => step(-1)}
        disabled={!status?.total}
        title="Previous match (⇧Enter)"
        aria-label="Previous match"
      >
        <ChevronUp size={13} />
      </button>
      <button
        className="icon-btn pdf-search-step"
        onClick={() => step(1)}
        disabled={!status?.total}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <ChevronDown size={13} />
      </button>
      {showList && (
        <ToolbarMenu anchorRef={list.ref} width={Math.max(360, list.ref.current?.offsetWidth ?? 0)}>
          <div className="pdf-hits" ref={listEl} role="listbox">
            {hits.slice(0, shown).map((h, i) => (
              <button
                key={i}
                data-hit={i}
                className={`pdf-hit ${i === current - 1 ? "current" : ""}`}
                onClick={() => {
                  goToReaderSearchHit(i);
                  list.setOpen(false);
                }}
                role="option"
                aria-selected={i === current - 1}
              >
                <span className="pdf-hit-page">p. {h.page}</span>
                <span className="pdf-hit-text">
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </span>
              </button>
            ))}
            {hits.length > shown && (
              <button className="pdf-hits-more" onClick={() => setShown(shown + PAGE)}>
                Show more matches ({hits.length - shown} more)
              </button>
            )}
          </div>
        </ToolbarMenu>
      )}
    </div>
  );
}
