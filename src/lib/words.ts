// Words: every word or phrase looked up from the PDF viewer's selection
// bar (lib/ai/lookup.ts), across every document, with its definition
// and where it was read — the PDF, the page and the sentence around it,
// so the list in the sidebar's Words can take the reader back there —
// and where on the page it was, so the pages keep it marked.
// The app's own: `words.json` in its data folder (src-tauri/src/words.rs),
// loaded at startup and written a moment after each change.
import { create } from "zustand";
import { appLog } from "./store";
import { invoke, isTauri } from "./tauri";

export interface WordEntry {
  id: string;
  /** As selected, tidied of line breaks. */
  word: string;
  definition: string;
  createdMs: number;
  /** Where it was read: the entry, its PDF, the 1-based page, and the
   *  sentence it stood in (found again and marked on the way back). */
  itemKey: string;
  attKey: string;
  page: number;
  title: string;
  context: string;
  /** Where the selection was on its page (PDF rects), to mark the word
   *  there; absent for one looked up from a highlight's editor, and for
   *  words kept before the marks. */
  place?: { pageIndex: number; rects: number[][] };
}

/** The sidebar's Words, beside Questions and Recent. */
export const WORDS = "words";

export const useWords = create<{ list: WordEntry[] }>(() => ({ list: [] }));

let saveTimer = 0;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!isTauri) return;
    invoke("save_words", { words: useWords.getState().list }).catch((e) => appLog("error", `Saving words failed: ${e}`));
  }, 300);
}

/** Called once, from bootstrap. */
export async function loadWords(): Promise<void> {
  try {
    const list = await invoke<WordEntry[]>("load_words");
    useWords.setState({ list: Array.isArray(list) ? list : [] });
  } catch (e) {
    appLog("debug", `Words unavailable: ${e}`);
  }
}

/** Keep a look-up. The same word looked up again in the same PDF
 *  replaces the one before. */
export function addWord(entry: Omit<WordEntry, "id" | "createdMs">): void {
  const key = entry.word.toLowerCase();
  const rest = useWords.getState().list.filter((w) => !(w.word.toLowerCase() === key && w.attKey === entry.attKey));
  const id = `word-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  useWords.setState({ list: [{ ...entry, id, createdMs: Date.now() }, ...rest] });
  save();
}

export function removeWord(id: string): void {
  useWords.setState({ list: useWords.getState().list.filter((w) => w.id !== id) });
  save();
}
