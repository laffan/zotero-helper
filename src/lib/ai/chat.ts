// The Questions conversations: creating one from a gathered request,
// sending turns, naming it, and keeping the lot on disk.
//
// The providers are stateless, so every turn resends the whole thing.
// What makes that affordable is that the papers sit at the head of the
// request and never change a byte, so after the first call they come
// back from the provider's prompt cache at roughly a tenth of the price
// — which is also why the panel counts the cache window down.
import { appLog, QUESTIONS, useStore } from "../store";
import { invoke } from "../tauri";
import type {
  AskDepth,
  Chat,
  ChatMessage,
  ChatSource,
  ChatUsage,
  PendingAsk,
} from "../types";
import { itemsForAsk, prepareAsk } from "./context";
import { usageCost } from "./models";

interface ChatReply {
  text: string;
  usage: ChatUsage;
  model: string;
  service: string;
}

/** What the Ask buttons call. Reads the works, prices the request, and
 *  puts it behind the confirmation popup — nothing is sent to a
 *  provider until the user says go. */
export async function startAsk(
  kind: ChatSource["kind"],
  keys: string[],
  collectionKey: string,
  sourceLabel: string,
  depth: AskDepth,
): Promise<void> {
  const store = useStore.getState();
  if (store.askPreparing) return;
  const items = itemsForAsk(kind, keys, collectionKey);
  if (items.length === 0) {
    appLog("warn", "Ask: nothing to read here");
    return;
  }
  store.setAskPreparing(true);
  try {
    const ask = await prepareAsk(kind, items, sourceLabel, depth);
    useStore.getState().setPendingAsk(ask);
    useStore.getState().setModal({ kind: "askCost" });
  } catch (e) {
    appLog("error", `Ask failed: ${e}`);
  } finally {
    useStore.getState().setAskPreparing(false);
  }
}

/** Accept the popup: make the conversation and open it in Questions. */
export function confirmAsk(ask: PendingAsk): void {
  const chat = createChat(ask);
  const store = useStore.getState();
  store.setPendingAsk(null);
  store.setModal(null);
  store.selectCollection(QUESTIONS);
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

/** Ask the open chat a question. Appends the turn, calls the provider,
 *  appends the reply, and books what it cost. */
export async function sendChatMessage(
  chatId: string,
  question: string,
): Promise<void> {
  const text = question.trim();
  if (!text) return;
  const store = useStore.getState();
  if (store.chatBusy) return;
  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat) return;

  const asked: ChatMessage = { role: "user", content: text, ts: Date.now() };
  let working: Chat = {
    ...chat,
    messages: [...chat.messages, asked],
    lastCallMs: Date.now(),
  };
  store.upsertChat(working);
  store.setChatBusy(chatId);

  try {
    const reply = await invoke<ChatReply>("ai_chat", {
      context: working.context,
      messages: working.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
    const cost = usageCost(reply.model, reply.usage);
    const answered: ChatMessage = {
      role: "assistant",
      content: reply.text,
      ts: Date.now(),
      usage: reply.usage,
      costUsd: cost,
    };
    working = {
      ...working,
      // A model swapped in Settings mid-conversation applies from the
      // turn it was used on; the chat records what actually answered.
      model: reply.model,
      messages: [...working.messages, answered],
      costUsd: working.costUsd + cost,
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
        .upsertChat({ ...cur, messages: working.messages.slice(0, -1) });
    }
    throw e;
  } finally {
    useStore.getState().setChatBusy(null);
  }
}

/** Name a chat from its opening exchange. A failure here is cosmetic —
 *  the chat keeps the source label it started with. */
async function nameChat(chatId: string): Promise<void> {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  if (!chat || chat.titled || chat.messages.length < 2) return;
  const question = chat.messages[0]?.content ?? "";
  const answer = chat.messages[1]?.content ?? "";
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
      title,
      titled: true,
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

export function persistChats(): Promise<void> {
  return new Promise((resolve) => {
    awaitingSave.push(resolve);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const settle = awaitingSave;
      awaitingSave = [];
      invoke("save_chats", { chats: useStore.getState().chats })
        .catch((e) => appLog("warn", `Could not save questions: ${e}`))
        .finally(() => settle.forEach((r) => r()));
    }, 400);
  });
}
