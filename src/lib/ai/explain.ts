// The reader's explainer: the selection bar's AI button opens a small
// conversation about the selected passage (ExplainChat.tsx), asking
// "Can you explain …?" straight away. It is an ordinary conversation
// about the entry — saved with the others, listed in its conversations
// tab and in Questions — with two differences: the backend answers it
// under a system prompt that keeps replies under 100 words (`mode`
// "explain", src-tauri/src/ai/chat.rs), and there is no cost popup
// first, since what it sends is small: the work's metadata and
// abstract and the text of the passage's page.
import { itemTitle } from "../collections";
import { useStore } from "../store";
import type { Chat } from "../types";
import { persistChats } from "./chat";
import { heading } from "./context";

/** Start an explainer of `text`, on page `page` (1-based) of
 *  `itemKey`'s PDF, whose words are `pageText`. */
export function startExplain(itemKey: string, text: string, page: number, pageText: string): void {
  const st = useStore.getState();
  const item = st.library.items.find((i) => i.key === itemKey);
  const settings = st.settings;
  if (!item || !settings) return;
  const abstract = String(item.data?.abstractNote ?? "").trim();
  const context = [
    "# The work",
    heading(item, 1),
    abstract || "_No abstract on record._",
    `# Page ${page} of its PDF, where the passage is`,
    pageText || "_No text could be read from this page._",
  ].join("\n\n");
  const passage = text.replace(/\s+/g, " ").trim();
  const short = passage.length > 48 ? `${passage.slice(0, 48).trimEnd()}…` : passage;
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
  st.setExplain({ chatId: chat.id, question: `Can you explain “${passage}”?` });
}
