// Look-up: the selection bar's magnifier asks the AI for a definition of
// the selected word or phrase — with no context at all, so the answer is
// the word's meaning and nothing about the work — in at most 50 words
// (the backend's "define" system prompt). It is a one-off, shown over
// the bar and never part of a conversation; each is kept in Words
// (lib/words.ts) with where it was read.
import { creatorSummary, itemTitle, yearOf } from "../collections";
import { appLog, useStore } from "../store";
import { invoke } from "../tauri";
import { addWord } from "../words";
import { fillPrompt, promptTemplate } from "./prompts";

/** Define `text`, read on page `page` of `attKey` (in the sentence
 *  `context`); resolves with the definition. */
export async function lookUp(itemKey: string, attKey: string, text: string, page: number, context: string): Promise<string> {
  const item = useStore.getState().library.items.find((i) => i.key === itemKey);
  const word = text.replace(/\s+/g, " ").trim();
  const question = fillPrompt(promptTemplate("lookup"), {
    selection: word,
    title: item ? itemTitle(item) : "",
    authors: item ? creatorSummary(item) : "",
    year: item ? yearOf(item) : "",
  });
  const reply = await invoke<{ text: string }>("ai_chat", {
    context: "",
    messages: [{ role: "user", content: question }],
    mode: "define",
  });
  // Plain text is asked for; emphasis a model adds anyway is dropped.
  const definition = reply.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2").trim();
  addWord({ word, definition, itemKey, attKey, page, title: item ? itemTitle(item) : "", context });
  appLog("info", `Looked up “${word}”`);
  return definition;
}
