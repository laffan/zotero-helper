// Clarifications: a passage of an answer selected and asked about, in
// a Questions conversation or an explainer. Each is a thread of its own
// (`Chat.threads`), shown as a column to the right of the one it was
// asked in, level with the passage, which stays marked there
// (components/ThreadStrip.tsx); a thread's own answers can be asked
// about in turn, as deep as the reader likes.
//
// What the model is sent for one: the conversation as it stood when the
// answer asked about was given — the chat's own messages up to that
// answer, or, for a thread asked in a thread, each thread on the way
// down up to the answer the next was asked of — then the clarification.
// So to the model it is an ordinary next turn, over the same works and
// under the same system prompt (askModel in chat.ts), and the works
// come from the provider's cache as any later turn's do. The question
// is the Clarify prompt (Settings → AI → Prompts), or the reader's own
// question about the passage. In a Questions conversation a thread can
// be carried on, as the conversation itself can; an explainer's can't.
//
// A thread's request runs apart from the conversation's (`useThreadBusy`),
// so the reader can ask about one passage while another is answered;
// each reply goes into the chat as it is when it comes. A request that
// fails leaves its question in the thread, unanswered, to be tried
// again (`retryThread`).
import { create } from "zustand";
import { creatorSummary, itemTitle, yearOf } from "../collections";
import { appLog, useStore } from "../store";
import type { Chat, ChatMessage, ChatThread } from "../types";
import { askModel, persistChats } from "./chat";
import { fillPrompt, promptTemplate } from "./prompts";

/** Where in an answer a clarification is asked: the thread it is in
 *  (null: the conversation's own), which message, and the passage. */
export interface ClarifyAt {
  parentId: string | null;
  messageIndex: number;
  quote: string;
  start: number;
  end: number;
}

/** The threads being answered, and why the last try of one failed, by
 *  `${chatId}/${threadId}`. */
export const useThreadBusy = create<{ busy: Record<string, true>; failed: Record<string, string> }>(() => ({
  busy: {},
  failed: {},
}));

export const threadKey = (chatId: string, threadId: string) => `${chatId}/${threadId}`;

export function threadOf(chat: Chat, id: string): ChatThread | undefined {
  return chat.threads?.find((t) => t.id === id);
}

/** The messages of thread `id`; null: the conversation's own. */
export function threadMessages(chat: Chat, id: string | null): ChatMessage[] {
  return id === null ? chat.messages : (threadOf(chat, id)?.messages ?? []);
}

/** The clarifications asked in thread `parentId` (null: the
 *  conversation's own), oldest first. */
export function threadsIn(chat: Chat, parentId: string | null): ChatThread[] {
  return (chat.threads ?? []).filter((t) => t.parentId === parentId);
}

/** Thread `id` and the threads it was asked in, outermost first. */
function lineage(chat: Chat, id: string): ChatThread[] {
  const chain: ChatThread[] = [];
  for (let t = threadOf(chat, id); t && chain.length < 100; t = t.parentId ? threadOf(chat, t.parentId) : undefined) {
    chain.unshift(t);
  }
  return chain;
}

/** What the model is sent for thread `id`: the conversation down to
 *  the answer it was asked of, then its own messages. */
export function threadHistory(chat: Chat, id: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let parent: string | null = null;
  for (const t of lineage(chat, id)) {
    out.push(...threadMessages(chat, parent).slice(0, t.messageIndex + 1));
    parent = t.id;
  }
  return [...out, ...threadMessages(chat, id)];
}

/** Is thread `id` waiting on an answer the last try didn't bring? */
export function unanswered(thread: ChatThread): boolean {
  return thread.messages[thread.messages.length - 1]?.role === "user";
}

function setBusy(key: string, on: boolean, failed?: string): void {
  useThreadBusy.setState((s) => {
    const busy = { ...s.busy };
    const fails = { ...s.failed };
    if (on) busy[key] = true;
    else delete busy[key];
    if (failed === undefined) delete fails[key];
    else fails[key] = failed;
    return { busy, failed: fails };
  });
}

/** Ask the model for thread `threadId`'s next answer — the question is
 *  already its last message — and put it in the chat as it is now. */
async function answerThread(chatId: string, threadId: string): Promise<void> {
  const key = threadKey(chatId, threadId);
  if (useThreadBusy.getState().busy[key]) return;
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const thread = chat && threadOf(chat, threadId);
  if (!chat || !thread || !unanswered(thread)) return;
  setBusy(key, true);
  try {
    const { answered, model } = await askModel(chat, threadHistory(chat, threadId));
    // Deleted, or the thread removed, while it was asked: nothing to
    // put the answer in.
    const now = useStore.getState().chats.find((c) => c.id === chatId);
    if (!now || !threadOf(now, threadId)) return setBusy(key, false);
    useStore.getState().upsertChat({
      ...now,
      model,
      threads: (now.threads ?? []).map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, answered] } : t,
      ),
      costUsd: now.costUsd + (answered.costUsd ?? 0),
      lastCallMs: Date.now(),
    });
    setBusy(key, false);
    await persistChats();
  } catch (e) {
    appLog("error", `Clarification failed: ${e}`);
    setBusy(key, false, String(e));
  }
}

/** Ask about a passage of an answer: a new thread, its question the
 *  Clarify prompt — or, with `question`, the reader's own about the
 *  passage — sent at once. Its id, for the strip to open its column. */
export function startClarify(chatId: string, at: ClarifyAt, question?: string): string | null {
  const st = useStore.getState();
  const chat = st.chats.find((c) => c.id === chatId);
  const quote = at.quote.replace(/\s+/g, " ").trim();
  if (!chat || !quote || at.end <= at.start) return null;
  const item = st.library.items.find((i) => i.key === chat.source.itemKeys[0]);
  const asked = question?.trim() ?? "";
  const content = asked
    ? `About this part of your last answer — “${quote}”: ${asked}`
    : fillPrompt(promptTemplate("clarify"), {
        selection: quote,
        title: item ? itemTitle(item) : "",
        authors: item ? creatorSummary(item) : "",
        year: item ? yearOf(item) : "",
      });
  const thread: ChatThread = {
    id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentId: at.parentId,
    messageIndex: at.messageIndex,
    quote,
    start: at.start,
    end: at.end,
    createdMs: Date.now(),
    // Shown as asked; the Clarify button's question isn't shown at all
    // (`display` ""): the column's head is the passage.
    messages: [{ role: "user", content, display: asked, ts: Date.now() }],
  };
  st.upsertChat({ ...chat, threads: [...(chat.threads ?? []), thread] });
  void persistChats();
  appLog("info", `Clarifying “${quote.length > 60 ? `${quote.slice(0, 60)}…` : quote}”`);
  void answerThread(chatId, thread.id);
  return thread.id;
}

/** Carry thread `threadId` on: another question, once it is answered. */
export function continueThread(chatId: string, threadId: string, question: string): boolean {
  const text = question.trim();
  const st = useStore.getState();
  const chat = st.chats.find((c) => c.id === chatId);
  const thread = chat && threadOf(chat, threadId);
  if (!chat || !thread || !text || unanswered(thread)) return false;
  if (useThreadBusy.getState().busy[threadKey(chatId, threadId)]) return false;
  const asked: ChatMessage = { role: "user", content: text, ts: Date.now() };
  st.upsertChat({
    ...chat,
    threads: (chat.threads ?? []).map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, asked] } : t)),
  });
  void persistChats();
  void answerThread(chatId, threadId);
  return true;
}

/** Ask again for the answer a thread's last try didn't bring. */
export function retryThread(chatId: string, threadId: string): void {
  void answerThread(chatId, threadId);
}

/** Remove thread `threadId` and every thread asked in it. What they
 *  cost stays in the conversation's total: it was spent. */
export function removeThread(chatId: string, threadId: string): void {
  const st = useStore.getState();
  const chat = st.chats.find((c) => c.id === chatId);
  if (!chat?.threads) return;
  const gone = new Set([threadId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of chat.threads) {
      if (t.parentId && gone.has(t.parentId) && !gone.has(t.id)) {
        gone.add(t.id);
        grew = true;
      }
    }
  }
  st.upsertChat({ ...chat, threads: chat.threads.filter((t) => !gone.has(t.id)) });
  void persistChats();
}
