// The reader's explainer: the selection bar's AI button opens a small
// conversation about the selected passage (ExplainChat.tsx), asking
// about it straight away in the words of Settings → AI → Prompts
// ("What would the encyclopedia entry for “…” be?" unless changed), of
// which the conversation shows only the passage. It is an ordinary
// conversation about the entry — saved with the others, listed in its
// conversations tab and in Questions — with two differences: the
// backend answers it under a system prompt that explains the concept on
// its own terms, in under 100 words (`mode` "explain",
// src-tauri/src/ai/chat.rs), and there is no cost popup first, since it
// sends nothing but the question — no page, no paper. The passage stays
// marked in the PDF (`passage`), and a tap on it opens the explainer
// again.
import { creatorSummary, itemTitle, yearOf } from "../collections";
import { useStore } from "../store";
import type { Chat } from "../types";
import { persistChats } from "./chat";
import { fillPrompt, promptTemplate } from "./prompts";

/** Start an explainer of `text`, on page `page` (1-based) of
 *  `itemKey`'s PDF; `passage` is where it is, to keep it marked. */
export function startExplain(itemKey: string, text: string, page: number, passage?: Chat["passage"]): void {
  const st = useStore.getState();
  const item = st.library.items.find((i) => i.key === itemKey);
  const settings = st.settings;
  if (!item || !settings) return;
  const context = "";
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
  const question = fillPrompt(promptTemplate("explain"), {
    selection: quoted,
    title: itemTitle(item),
    authors: creatorSummary(item),
    year: yearOf(item),
  });
  st.setExplain({ chatId: chat.id, question, display: quoted });
}
