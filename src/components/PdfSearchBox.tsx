// The toolbar's search field while a PDF is open: it finds words in
// that PDF instead of searching the library. Typing searches (after a
// short pause), Enter / ⇧Enter and the arrows step through the hits,
// Escape clears, and ⌘F comes back to the field.
import { useEffect, useRef, useState } from "react";
import type { SearchStatus } from "../pdfviewer/search";
import { ChevronDown, ChevronUp, SearchIcon } from "./Icons";
import { searchReader, stepReaderSearch } from "./ReaderPane";

const DEBOUNCE_MS = 250;

export function PdfSearchBox() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const timer = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const run = (q: string) => {
    window.clearTimeout(timer.current);
    searchReader(q, setStatus);
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

  return (
    <div className="toolbar-search pdf-search">
      <span className="pdf-search-glyph" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        ref={input}
        type="search"
        placeholder="Search this PDF"
        value={query}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => run(q), DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            setQuery("");
            run("");
          }
        }}
        aria-label="Search this PDF"
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
    </div>
  );
}
