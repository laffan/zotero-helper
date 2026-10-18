// The reader's explainer: the selection bar's AI button opens a small
// window about the selected passage (ExplainChat.tsx), asking about it
// straight away in the words of Settings → AI → Prompts ("What would the
// encyclopedia entry for “…” be?" unless changed), of which the window
// shows only the passage. It is kept as a conversation about the entry —
// one question and its answer, saved with the others and listed under
// Explanations (the entry's conversations tab, and the sidebar's
// Explanations) — answered by the backend under its own system prompt,
// in under 100 words (`mode` "explain", src-tauri/src/ai/chat.rs).
//
// The window's toggle says what goes with the question. No Context, the
// default: nothing — no page, no paper — so the concept is explained on
// its own terms, and there is no cost popup first. Context: the work's
// metadata, the page the passage was read on, and the text of the PDF
// around it (explainContext), so the answer can say what the passage
// means in this work ("explain-context"); switching asks again, the new
// answer in place of the old. The passage stays marked in the PDF
// (`passage`), and a tap on it opens the explainer again.
import { creatorSummary, itemTitle, pdfAttachmentOf, yearOf } from "../collections";
import { useStore } from "../store";
import { invoke } from "../tauri";
import type { Chat } from "../types";
import { persistChats } from "./chat";
import { heading } from "./context";
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

/** What an explainer asked with its context is grounded in: the work's
 *  metadata, the page its passage was read on, and the text of the PDF
 *  around that page, with page markers (the whole of it, for a PDF of up
 *  to 80 pages). `total` is the PDF's page count, when the viewer has it
 *  open. Read from the PDF on this device (or Zotero), never sent as a
 *  file. */
export async function explainContext(chat: Chat, total: number | null): Promise<string> {
  const items = useStore.getState().library.items;
  const itemKey = chat.source.itemKeys[0];
  const item = items.find((i) => i.key === itemKey);
  if (!item) throw new Error("the entry is no longer in the library");
  const attKey = chat.passage?.attKey ?? pdfAttachmentOf(items, itemKey)?.key;
  const page = (chat.passage?.pageIndex ?? 0) + 1;
  if (!attKey) return `# The work the passage was read in\n\n${heading(item, 1)}\n\n_No PDF in Zotero._\n`;
  // The parser loads on demand, as Ask Full Papers' does.
  const [{ extractFullText, extractTextAround, pageMarker }, bytes] = await Promise.all([
    import("../pdfText"),
    invoke<ArrayBuffer>("download_attachment_file", { attKey }),
  ]);
  const where = chat.passage
    ? `The passage was selected on page ${page} of the PDF (after the ${pageMarker(page)} marker below).`
    : "";
  const { text, truncated } = total ? await extractTextAround(bytes, page, total) : await extractFullText(bytes);
  const body = text.trim()
    ? `## The PDF's text${truncated ? " (cut short)" : ""}\n\n${text}`
    : "_The PDF yielded no text (it is probably a scan)._";
  return `# The work the passage was read in\n\n${heading(item, 1)}\n\n${where}\n\n${body}\n`;
}
