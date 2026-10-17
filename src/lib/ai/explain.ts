// The reader's explainer: the selection bar's AI button opens a small
// conversation about the selected passage (ExplainChat.tsx), asking
// about it straight away — "While reading [title] by [authors] from
// [year], I came across the following: … Can you explain that a bit?",
// of which the conversation shows only the passage. It is an ordinary
// conversation
// about the entry — saved with the others, listed in its conversations
// tab and in Questions — with two differences: the backend answers it
// under a system prompt that keeps replies under 100 words (`mode`
// "explain", src-tauri/src/ai/chat.rs), and there is no cost popup
// first, since what it sends is small: the question, and the text of
// the passage's page for its context — never the paper. The passage stays marked
// in the PDF (`passage`), and a tap on it opens the explainer again.
import { creatorSummary, itemTitle, yearOf } from "../collections";
import { useStore } from "../store";
import type { Chat } from "../types";
import { persistChats } from "./chat";

/** Start an explainer of `text`, on page `page` (1-based) of
 *  `itemKey`'s PDF, whose words are `pageText`; `passage` is where it
 *  is, to keep it marked. */
export function startExplain(
  itemKey: string,
  text: string,
  page: number,
  pageText: string,
  passage?: Chat["passage"],
): void {
  const st = useStore.getState();
  const item = st.library.items.find((i) => i.key === itemKey);
  const settings = st.settings;
  if (!item || !settings) return;
  const context = [
    `# Page ${page} of the PDF, where the passage is`,
    pageText || "_No text could be read from this page._",
  ].join("\n\n");
  const quoted = text.replace(/\s+/g, " ").trim();
  const short = quoted.length > 48 ? `${quoted.slice(0, 48).trimEnd()}…` : quoted;
  const service = settings.aiService;
  const chat: Chat = {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // Named by its passage, which is how it will be looked for again.
    title: `Explain “${short}”`,
    titled: true,
    createdMs: Date.now(),
    service,
    model: service === "openai" ? settings.openaiModel : settings.anthropicModel,
    mode: "explain",
    passage,
    source: {
      kind: "item",
      itemKeys: [itemKey],
      label: `${itemTitle(item)}, p. ${page}`,
      itemTitles: [itemTitle(item)],
      depth: "abstracts",
      missing: [],
    },
    context,
    // A four-characters-a-token estimate; the replies book the real cost.
    contextTokens: Math.ceil(context.length / 4),
    messages: [],
    costUsd: 0,
    lastCallMs: 0,
  };
  st.upsertChat(chat);
  void persistChats();
  st.setExplain({ chatId: chat.id, question: explainQuestion(itemTitle(item), creatorSummary(item), yearOf(item), quoted), display: quoted });
}

/** The first question: the work it was read in, then the passage. */
function explainQuestion(title: string, authors: string, year: string, passage: string): string {
  const by = authors ? ` by ${authors}` : "";
  const when = year ? ` from ${year}` : "";
  return `While reading “${title}”${by}${when}, I came across the following:\n\n“${passage}”\n\nCan you explain that a bit?`;
}
