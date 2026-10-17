// The sidebar's Words: every word or phrase looked up in a PDF (the
// selection bar's magnifier, lib/ai/lookup.ts), across all documents,
// alphabetically, with its definition and where it was read. The
// source line opens that PDF at the page, the sentence it stood in
// marked (as an AI citation's passage is). A filter box narrows the
// list by word or definition.
import { useMemo, useState } from "react";
import { removeWord, useWords, type WordEntry } from "../lib/words";
import { TrashIcon } from "./Icons";
import { openReaderAt } from "./ReaderPane";

function WordRow({ w }: { w: WordEntry }) {
  return (
    <div className="word-row">
      <div className="word-row-main">
        <div className="word-row-word">{w.word}</div>
        <div className="word-row-def">{w.definition}</div>
        <button
          className="link-btn word-row-source"
          onClick={() => openReaderAt(w.itemKey, w.attKey, w.page, { quote: w.context })}
          title={w.context ? `“${w.context}”` : undefined}
        >
          {w.title || "Untitled"}, p. {w.page}
        </button>
      </div>
      <button
        className="icon-btn word-row-delete"
        onClick={() => removeWord(w.id)}
        aria-label={`Remove “${w.word}”`}
        title="Remove from Words"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

export function WordList() {
  const words = useWords((s) => s.list);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words
      .filter((w) => !q || w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q))
      .sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
  }, [words, query]);

  return (
    <section className="item-list word-list">
      <div className="view-bar">
        <span className="chat-list-heading">Words</span>
        <input
          className="word-list-filter"
          type="search"
          placeholder="Filter words…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="list-body">
        {words.length === 0 ? (
          <div className="list-empty">
            No words yet — select a word in a PDF and use the magnifier over it to look it up.
          </div>
        ) : (
          shown.map((w) => <WordRow key={w.id} w={w} />)
        )}
      </div>
      <footer className="list-footer">
        <span>
          {words.length} word{words.length === 1 ? "" : "s"}
        </span>
      </footer>
    </section>
  );
}
