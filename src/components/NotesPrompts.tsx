// An empty note's starting point: the reading questions
// (noteseditor/prompts.ts), drawn where the notes would begin. Pointing
// at them offers Use (every question becomes a heading to write under)
// and Clear (they go, and stay gone for this entry); clicking one
// question starts the notes with just that one. Typing anything sends
// them away as a placeholder would — and a line begun with "?" offers
// them again, in the editor.
import { useEffect, useState } from "react";
import { allPromptsMarkdown, headingBlock, PROMPT_GROUPS } from "../noteseditor/prompts";

const CLEARED_KEY = "zotero-helper-prompts-cleared";

function clearedFor(itemKey: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(CLEARED_KEY) ?? "[]") as string[]).includes(itemKey);
  } catch {
    return false;
  }
}

function markCleared(itemKey: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? "[]") as string[];
    localStorage.setItem(CLEARED_KEY, JSON.stringify([...list.filter((k) => k !== itemKey), itemKey].slice(-2000)));
  } catch {
    // Not kept, then: they come back next time the note is opened.
  }
}

interface Props {
  itemKey: string;
  /** Where the editor's first line starts, within the overlay's box. */
  at: { top: number; left: number } | null;
  setDoc: (text: string, caret: number) => void;
  focusEditor: () => void;
}

export function NotesPrompts({ itemKey, at, setDoc, focusEditor }: Props) {
  const [cleared, setCleared] = useState(() => clearedFor(itemKey));
  useEffect(() => setCleared(clearedFor(itemKey)), [itemKey]);
  if (cleared || !at) return null;

  const use = () => {
    const { text, caret } = allPromptsMarkdown();
    setDoc(text, caret);
  };
  const pick = (prompt: string) => {
    const { text, caret } = headingBlock(prompt);
    setDoc(text, caret);
  };
  const clear = () => {
    markCleared(itemKey);
    setCleared(true);
    focusEditor();
  };

  return (
    <div className="notes-prompts" style={{ top: at.top, left: at.left }}>
      <div
        className="notes-prompts-list"
        onMouseDown={(e) => {
          // The press doesn't move the focus (or the caret the buttons
          // place); between the questions, it is a press in the notes.
          e.preventDefault();
          if (e.target === e.currentTarget) focusEditor();
        }}
      >
        {PROMPT_GROUPS.map((group, g) => (
          <ul key={g}>
            {group.map((p) => (
              <li key={p}>
                <button className="notes-prompt" onClick={() => pick(p)} title="Start the notes with this question">
                  - {p}
                </button>
              </li>
            ))}
          </ul>
        ))}
        <div className="notes-prompts-actions">
          <button className="link-btn" onClick={use} title="Every question as a heading, with room to write under each">
            Use
          </button>
          <button className="link-btn" onClick={clear} title="Start from an empty page">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
