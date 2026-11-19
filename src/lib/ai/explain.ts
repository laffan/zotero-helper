// The reader's explainer: the selection bar's AI button (or a
// highlight's) opens a small window about the selected passage
// (ExplainChat.tsx), asking about it — once Ask is pressed — in the
// words of Settings → AI → Prompts ("What would the encyclopedia entry
// for “…” be?" unless changed), of which the window shows only the
// passage. It is kept as a conversation about the entry —
// one question and its answer, saved with the others and listed under
// Explanations (the entry's conversations tab, and the sidebar's
// Explanations) — answered by the backend under its own system prompt,
// in under 100 words (`mode` "explain", src-tauri/src/ai/chat.rs).
//
// The window's toggle says what goes with the question. No Context, the
// default: nothing — no page, no paper — so the concept is explained on
// its own terms, and there is no cost popup first. In Context: the
// work's metadata and the text of a part of its PDF, the reader's choice
// (ExplainContextMenu.tsx) — all of it, the section the passage is in,
// or the pages in view (contextParts, explainContext) — so the answer
// can say what the passage means in this work ("explain-context");
// asking again with another, the new answer takes the old one's place.
// One closed before anything was asked is let go of (dropUnasked). The
// passage
// stays marked in the PDF (`passage`), and a tap on it opens the
// explainer again. A long passage is headed in the lists by a short
// title the model gives it (headExplanation).
import { creatorSummary, itemTitle, yearOf } from "../collections";
import { useStore } from "../store";
import { invoke } from "../tauri";
import type { Chat, ContextPart } from "../types";
import { nameChat, persistChats, removeChat } from "./chat";
import { heading as headingOf } from "./context";
import { fillPrompt, promptTemplate } from "./prompts";

// An explainer closed before anything was asked — no question in it,
// nothing spent on it — is let go of with its window: it was never more
// than its passage (and its underline). Watched from the store, so every
// way the window goes counts: closed, another opened, the PDF closed.
let watching = false;
function dropUnasked(): void {
  if (watching) return;
  watching = true;
  useStore.subscribe((s, prev) => {
    const was = prev.explain?.chatId;
    if (!was || was === s.explain?.chatId) return;
    const chat = s.chats.find((c) => c.id === was);
    if (chat && !chat.messages.length && !chat.costUsd && s.chatBusy !== was) void removeChat(was);
  });
}

/** Start an explainer of `text`, on page `page` (1-based) of
 *  `itemKey`'s PDF; `passage` is where it is, to keep it marked. Its
 *  window opens with the passage and asks nothing until Ask is pressed
 *  (ExplainChat.tsx). */
export function startExplain(itemKey: string, text: string, page: number, passage?: Chat["passage"]): void {
  dropUnasked();
  const st = useStore.getState();
  const item = st.library.items.find((i) => i.key === itemKey);
  const settings = st.settings;
  if (!item || !settings) return;
  const context = "";
  const quoted = text.replace(/\s+/g, " ").trim();
  // A highlight explained before, its text unchanged — or the same words
  // on the same page explained before, from a selection or a highlight:
  // that explanation, opened again, rather than another one paid for.
  const known =
    passage &&
    st.chats.find(
      (c) =>
        c.mode === "explain" &&
        c.passage?.attKey === passage.attKey &&
        c.messages[0]?.display === quoted &&
        (passage.annotationKey
          ? c.passage.annotationKey === passage.annotationKey || c.passage.pageIndex === passage.pageIndex
          : c.passage.pageIndex === passage.pageIndex),
    );
  if (known) return st.setExplain({ chatId: known.id });
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

/** A passage longer than this many words is headed, in the lists, by a
 *  short title (`Chat.heading`) rather than by itself. */
const LONG_WORDS = 6;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** Is `text` too long to head an explanation by itself? */
export const isLongPassage = (text: string) => words(text).length > LONG_WORDS;

/** The passage's first words, for a head while it has no title of its
 *  own (an explanation from before, or one whose naming failed). */
export const firstWords = (text: string) => `${words(text).slice(0, LONG_WORDS).join(" ")}…`;

// Headings are asked for one at a time: the lists ask for every long
// explanation that lacks one as it comes into view.
const naming = new Set<string>();
let headings: Promise<void> = Promise.resolve();

/** Give the explanation `chatId`, if its passage is long, a short title
 *  of the model's (once it has an answer, and once only). */
export function headExplanation(chatId: string): void {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const passage = chat?.messages[0]?.display ?? "";
  if (!chat || chat.heading || naming.has(chatId) || !isLongPassage(passage)) return;
  if (!chat.messages.some((m) => m.role === "assistant")) return;
  naming.add(chatId);
  headings = headings.then(() => nameChat(chatId, "heading")).finally(() => naming.delete(chatId));
}

/** Pages in a whole PDF's context, at most: a longer one sends this
 *  many pages around the passage. */
const FULL_PAGES = 80;

const pagesLabel = (from: number, to: number) => (from === to ? `p. ${from}` : `pp. ${from}–${to}`);

/** The parts of the PDF `attKey` an explainer of a passage on `page`
 *  (1-based) can be asked with: all of it — the 80 pages around the
 *  passage, for a longer one — the section the passage is in (none
 *  without an outline, or before its first heading) and the pages in
 *  view (none unless known). `total`: its page count, 0 if unknown. */
export function contextParts(
  attKey: string,
  page: number,
  total: number,
  section: { title: string; from: number; to: number } | null,
  visible: [number, number] | null,
): { full: ContextPart; section: ContextPart | null; visible: ContextPart | null } {
  let full: ContextPart = { attKey, kind: "full", from: 1, to: total, label: "the full text" };
  if (total > FULL_PAGES) {
    const from = Math.max(1, Math.min(page - FULL_PAGES / 2, total - FULL_PAGES + 1));
    const to = from + FULL_PAGES - 1;
    full = { attKey, kind: "full", from, to, label: `${pagesLabel(from, to)}, the ${FULL_PAGES} pages around the passage` };
  }
  return {
    full,
    section: section && {
      attKey,
      kind: "section",
      from: section.from,
      to: section.to,
      label: `section “${section.title}”, ${pagesLabel(section.from, section.to)}`,
    },
    visible: visible && {
      attKey,
      kind: "visible",
      from: visible[0],
      to: visible[1],
      label: `the visible ${visible[1] > visible[0] ? "pages" : "page"}, ${pagesLabel(visible[0], visible[1])}`,
    },
  };
}

/** What an explainer asked with its context is grounded in: the work's
 *  metadata — its title and authors, year, publication — and the text
 *  of `part` of its PDF, page markers and all, saying which part when
 *  it isn't the whole. Nothing about the passage: its page goes with
 *  the question (chat.ts), so the same part of the same PDF is the same
 *  context for every passage, and the provider's cache serves it to the
 *  next (contextCache.ts). Read from the PDF on this device (or Zotero),
 *  never sent as a file. */
export async function explainContext(chat: Chat, part: ContextPart): Promise<string> {
  const items = useStore.getState().library.items;
  const item = items.find((i) => i.key === chat.source.itemKeys[0]);
  if (!item) throw new Error("the entry is no longer in the library");
  const head = `# The work the passage was read in\n\n${headingOf(item, 1)}`;
  // The parser loads on demand, as Ask Full Papers' does.
  const [{ extractFullText, extractPageSpan }, bytes] = await Promise.all([
    import("../pdfText"),
    invoke<ArrayBuffer>("download_attachment_file", { attKey: part.attKey }),
  ]);
  const whole = part.kind === "full" && part.from === 1 && part.to <= FULL_PAGES;
  const { text, truncated } = whole ? await extractFullText(bytes) : await extractPageSpan(bytes, part.from, part.to);
  const notes = [
    whole ? "" : `\n- Only part of this work is included: ${part.label}`,
    truncated ? "\n- Note: long text, cut short below" : "",
  ].join("");
  const body = text.trim() ? `## The PDF's text\n\n${text}` : "_The PDF yielded no text (it is probably a scan)._";
  return `${head}${notes}\n\n${body}\n`;
}
