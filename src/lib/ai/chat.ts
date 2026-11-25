// The Questions conversations: creating one from a gathered request,
// sending turns, naming it, and keeping the lot on disk.
//
// The providers are stateless, so every turn resends the whole thing.
// What makes that affordable is that the papers sit at the head of the
// request and never change a byte, so after the first call they come
// back from the provider's prompt cache at roughly a tenth of the price
// — which is also why the panel counts the cache window down.
import { startPdfFetch } from "../importer";
import { appLog, QUESTIONS, useStore } from "../store";
import { invoke } from "../tauri";
import type {
  AskDepth,
  AskTarget,
  Chat,
  ChatMessage,
  ChatUsage,
  ImportStage,
  PageSpan,
  PendingAsk,
} from "../types";
import { getAbstracts } from "./index";
import { itemsForAsk, prepareAsk } from "./context";
import { noteSent } from "./contextCache";
import { usageCost } from "./models";
import { shareDisk } from "../windows/channel";

interface ChatReply {
  text: string;
  usage: ChatUsage;
  model: string;
  service: string;
}

/** What the AI menu's two Ask entries call. Reads the works, prices the
 *  request, and puts it behind the confirmation popup — nothing is sent
 *  to a provider until the user says go. */
/** `pages`: only that part of the one PDF asked about (Ask PDF). */
export async function startAsk(
  target: AskTarget,
  depth: AskDepth,
  pages?: PageSpan,
): Promise<void> {
  const store = useStore.getState();
  if (store.askPreparing) return;
  const items = itemsForAsk(target);
  if (items.length === 0) {
    appLog("warn", "Ask: nothing to read here");
    return;
  }
  store.setAskPreparing(true);
  try {
    const ask = await prepareAsk(target, items, depth, pages);
    useStore.getState().setPendingAsk(ask);
    useStore.getState().setModal({ kind: "askCost" });
  } catch (e) {
    appLog("error", `Ask failed: ${e}`);
  } finally {
    useStore.getState().setAskPreparing(false);
  }
}

/** Stages a PDF job passes through before it either lands or parks. */
const PDF_JOB_RUNNING: ImportStage[] = [
  "pending",
  "resolving",
  "creating",
  "finding-pdf",
  "downloading",
  "uploading",
];

/** Run the PDF pipeline over the given entries and return once every
 *  one of them has either finished or parked for manual rescue. The
 *  pipeline is driven by the job queue rather than a promise, so this
 *  watches the queue rather than awaiting it. */
async function fetchMissingPdfs(keys: string[]): Promise<void> {
  if (startPdfFetch(keys) === 0) return;
  const wanted = new Set(keys);
  // Generous: a folder of parked items can take a while. The user can
  // close the popup and start over if a rescue needs their attention.
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const s = useStore.getState();
    const running = s.jobOrder
      .map((id) => s.jobs[id])
      .some(
        (j) =>
          j?.itemKey &&
          wanted.has(j.itemKey) &&
          PDF_JOB_RUNNING.includes(j.stage),
      );
    if (!running || Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Fill the request's gaps — fetch the missing PDFs, or read the
 *  missing abstracts out of the PDFs that are there — then re-gather
 *  and re-price, because both change the token count. */
export async function refillAsk(ask: PendingAsk): Promise<void> {
  const store = useStore.getState();
  if (store.askPreparing) return;
  const fixable = ask.gaps.filter((g) => g.fixable).map((g) => g.key);
  if (fixable.length === 0) return;
  store.setAskPreparing(true);
  try {
    if (ask.source.depth === "full") {
      await fetchMissingPdfs(fixable);
    } else {
      await getAbstracts(fixable);
    }
    const items = itemsForAsk(ask.target);
    const next = await prepareAsk(ask.target, items, ask.source.depth, ask.source.pages, ask.source.uncapped);
    // The user may have closed the popup while this ran; don't reopen
    // something they dismissed.
    if (useStore.getState().modal?.kind === "askCost") {
      useStore.getState().setPendingAsk(next);
    }
  } catch (e) {
    appLog("error", `Retrieval failed: ${e}`);
  } finally {
    useStore.getState().setAskPreparing(false);
  }
}

/** The cost popup's "Send all": read the works again past the caps
 *  (lib/pdfText.ts), every page of each, and re-price. */
export async function uncapAsk(ask: PendingAsk): Promise<void> {
  const store = useStore.getState();
  if (store.askPreparing) return;
  store.setAskPreparing(true);
  try {
    const next = await prepareAsk(ask.target, itemsForAsk(ask.target), ask.source.depth, ask.source.pages, true);
    if (useStore.getState().modal?.kind === "askCost") useStore.getState().setPendingAsk(next);
  } catch (e) {
    appLog("error", `Reading the whole text failed: ${e}`);
  } finally {
    useStore.getState().setAskPreparing(false);
  }
}

/** Accept the popup: make the conversation and open it — in Questions,
 *  or, with a PDF open (the library out of sight), in the right panel's
 *  conversations tab, beside the PDF. */
export function confirmAsk(ask: PendingAsk): void {
  const chat = createChat(ask);
  const store = useStore.getState();
  store.setPendingAsk(null);
  store.setModal(null);
  if (store.reading) store.setMetaTab("chats");
  else store.selectCollection(QUESTIONS);
  store.selectChat(chat.id);
}

/** Turn a confirmed request into a conversation and open it. */
export function createChat(ask: PendingAsk): Chat {
  const chat: Chat = {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // Named properly once there's an exchange to name it from.
    title: ask.source.label,
    titled: false,
    createdMs: Date.now(),
    service: ask.service,
    model: ask.model,
    source: ask.source,
    context: ask.context,
    contextTokens: ask.tokens,
    messages: [],
    costUsd: 0,
    lastCallMs: 0,
  };
  const store = useStore.getState();
  store.upsertChat(chat);
  void persistChats();
  appLog(
    "info",
    `Question started: “${chat.title}” — ${ask.source.itemKeys.length} work(s), ${ask.tokens} tokens of context`,
  );
  return chat;
}

/** What the backend answers `chat` as: its kind of conversation. An
 *  explainer asked with its context (explain.ts) is answered about the
 *  passage in its work. */
function modeOf(chat: Chat): string | null {
  return chat.mode === "explain" && chat.context ? "explain-context" : (chat.mode ?? null);
}

/** The messages as sent. An explainer asked with its context is told
 *  in its question which page the passage is on — not in the context,
 *  which stays the same for every passage of the PDF, so that the
 *  provider's cache serves it to the next one (contextCache.ts). */
function asSent(chat: Chat, messages: ChatMessage[]): { role: string; content: string }[] {
  const page = chat.mode === "explain" && chat.context && chat.passage ? chat.passage.pageIndex + 1 : 0;
  return messages.map((m, i) => ({
    role: m.role,
    content: page && i === 0 ? `${m.content}\n\n(The passage is on page ${page} of the PDF.)` : m.content,
  }));
}

/** Ask the model `messages` over `chat`'s works (its context, its
 *  mode): the answer as a message, with what it cost, and the model
 *  that gave it. The conversation's own turns and its clarifications'
 *  (threads.ts) both go through here. */
export async function askModel(
  chat: Chat,
  messages: ChatMessage[],
): Promise<{ answered: ChatMessage; model: string }> {
  const reply = await invoke<ChatReply>("ai_chat", {
    context: chat.context,
    messages: asSent(chat, messages),
    mode: modeOf(chat),
  });
  if (chat.mode === "explain" && chat.context && chat.contextPart) {
    noteSent(chat.contextPart, reply.service === "openai" ? "openai" : "anthropic", reply.model, reply.usage);
  }
  const costUsd = usageCost(reply.model, reply.usage);
  return {
    model: reply.model,
    answered: { role: "assistant", content: reply.text, ts: Date.now(), usage: reply.usage, costUsd },
  };
}

/** Ask the open chat a question. Appends the turn, calls the provider,
 *  appends the reply, and books what it cost. `display` is what the
 *  conversation shows of the question, when not the whole of it. The
 *  reply goes into the chat as it is when the reply comes, not as it
 *  was asked: a clarification may have been asked meanwhile. */
export async function sendChatMessage(
  chatId: string,
  question: string,
  display?: string,
): Promise<void> {
  const text = question.trim();
  if (!text) return;
  const store = useStore.getState();
  if (store.chatBusy) return;
  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat) return;

  const asked: ChatMessage = { role: "user", content: text, ts: Date.now(), ...(display ? { display } : {}) };
  let working: Chat = {
    ...chat,
    messages: [...chat.messages, asked],
    lastCallMs: Date.now(),
  };
  store.upsertChat(working);
  store.setChatBusy(chatId);

  try {
    const { answered, model } = await askModel(working, working.messages);
    // Deleted while the request was in flight: nothing to put it in.
    const now = useStore.getState().chats.find((c) => c.id === chatId);
    if (!now) return;
    working = {
      ...now,
      // A model swapped in Settings mid-conversation applies from the
      // turn it was used on; the chat records what actually answered.
      model,
      messages: [...now.messages, answered],
      costUsd: now.costUsd + (answered.costUsd ?? 0),
      lastCallMs: Date.now(),
    };
    useStore.getState().upsertChat(working);
    await persistChats();
    if (!working.titled) await nameChat(working.id);
  } catch (e) {
    appLog("error", `Question failed: ${e}`);
    // Put the unanswered question back in the box rather than leaving a
    // turn dangling with no reply. (Unless the chat was deleted while
    // the request was in flight, in which case there is nothing to fix.)
    const cur = useStore.getState().chats.find((c) => c.id === chatId);
    if (cur) {
      useStore
        .getState()
        .upsertChat({ ...cur, messages: cur.messages.filter((m) => m !== asked) });
    }
    throw e;
  } finally {
    useStore.getState().setChatBusy(null);
  }
}

/** Name a chat from its opening exchange. A failure here is cosmetic —
 *  the chat keeps the source label it started with. `as` "heading": an
 *  explainer's heading (explain.ts), named from its passage and its
 *  latest answer; its title is left alone. */
export async function nameChat(chatId: string, as: "title" | "heading" = "title"): Promise<void> {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const first = chat?.messages[0];
  const last = chat && [...chat.messages].reverse().find((m) => m.role === "assistant");
  if (!chat || !first || !last || (as === "title" ? chat.titled : chat.heading)) return;
  const question = as === "heading" ? (first.display ?? first.content) : first.content;
  const answer = as === "heading" ? last.content : (chat.messages[1]?.content ?? "");
  try {
    const reply = await invoke<ChatReply>("ai_chat_title", {
      question,
      answer,
    });
    const parsed = JSON.parse(reply.text) as { title?: string };
    const title = String(parsed.title ?? "").trim();
    if (!title) return;
    const cost = usageCost(reply.model, reply.usage);
    const cur = useStore.getState().chats.find((c) => c.id === chatId);
    if (!cur) return;
    useStore.getState().upsertChat({
      ...cur,
      ...(as === "heading" ? { heading: title } : { title, titled: true }),
      costUsd: cur.costUsd + cost,
    });
    await persistChats();
  } catch (e) {
    appLog("debug", `Could not name the conversation: ${e}`);
  }
}

export async function removeChat(chatId: string): Promise<void> {
  useStore.getState().deleteChat(chatId);
  await persistChats();
}

/** Load conversations from the app data dir at startup. */
export async function loadChats(): Promise<void> {
  try {
    const chats = await invoke<Chat[]>("load_chats");
    useStore.getState().setChats(Array.isArray(chats) ? chats : []);
  } catch (e) {
    appLog("warn", `Could not load saved questions: ${e}`);
  }
}

// Writes are coalesced: a reply lands as several store updates in a
// row, and a full-paper chat is megabytes of JSON. Callers that awaited
// a superseded write are resolved by the one that replaced it — never
// left hanging, or a caller's `finally` would never run.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let awaitingSave: (() => void)[] = [];
// The other windows read them again once written (lib/windows/) — the
// list from the disk, since a full-paper chat is too big to send.
const written = shareDisk("chats", () => loadChats(), () => saveTimer !== null);

export function persistChats(): Promise<void> {
  return new Promise((resolve) => {
    awaitingSave.push(resolve);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const settle = awaitingSave;
      awaitingSave = [];
      invoke("save_chats", { chats: useStore.getState().chats })
        .then(written)
        .catch((e) => appLog("warn", `Could not save questions: ${e}`))
        .finally(() => settle.forEach((r) => r()));
    }, 400);
  });
}
