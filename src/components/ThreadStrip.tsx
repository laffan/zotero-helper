// The strip a conversation is read in (ChatPanel.tsx) — an explainer's
// too (ExplainChat.tsx): its own messages in the first column, and to
// the right, a column for each clarification open (lib/ai/threads.ts).
//
// A passage of an answer selected and asked about (ClarifyPopover.tsx)
// is answered in a new column right of the one it was asked in, headed
// by the passage and a back arrow, which closes it. Each column starts
// at the top and scrolls by itself; the strip scrolls sideways between
// them, settling on a column's edge. The passages asked about stay
// marked in their answers (threadMarks.ts), the one whose column is
// open more strongly; a tap on one opens its column, or closes it if
// open. One column is open to the right of each, so the open ones are a
// path — the conversation, a clarification of it, a clarification of
// that — and opening another from a column closes those right of it. A
// column opened is scrolled into view, and closing one brings the
// column it was asked in back. Each column is the strip's width when
// the strip is narrow (the details panel, the explainer), half of it
// when there is room for two. Clarifications are deleted with their
// conversation, not one by one.
//
// `continuable`: a clarification has a box at its foot to carry it on (a
// Questions conversation); an explainer's are answered and that's all.
// `hideQuestion`: the conversation's first question isn't shown (the
// explainer shows its passage above, `rootBefore`).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ThreadMark } from "../lib/ai/threadMarks";
import {
  continueThread,
  retryThread,
  startClarify,
  threadKey,
  threadOf,
  threadsIn,
  unanswered,
  useThreadBusy,
} from "../lib/ai/threads";
import type { Chat, ChatMessage, ChatSource, ChatThread } from "../lib/types";
import { Bubble } from "./ChatBubble";
import { ClarifyPopover, useClarifySelection } from "./ClarifyPopover";
import { ArrowLeftIcon, Spinner } from "./Icons";

/** Wide enough for two columns side by side, px. */
const TWO_COLUMNS = 640;

/** The strip back at its first column, scrolled to its foot — the
 *  conversation's latest. */
export function followRoot(strip: HTMLElement): void {
  const root = strip.querySelector<HTMLElement>(".thread-col");
  if (!root) return;
  strip.scrollLeft = 0;
  root.scrollTop = root.scrollHeight;
}

/** A column's messages, each where a selection can find it. The
 *  question the Clarify button asked (`display` "") isn't shown. */
function Messages({
  messages,
  source,
  marks,
  hideFirst = false,
}: {
  messages: ChatMessage[];
  source: ChatSource;
  marks: Map<number, ThreadMark[]>;
  hideFirst?: boolean;
}) {
  return (
    <>
      {messages.map((m, i) =>
        m.role === "user" && (m.display === "" || (hideFirst && i === 0)) ? null : (
          <div className="thread-msg" data-index={i} key={i}>
            <Bubble role={m.role} content={m.display ?? m.content} source={source} marks={marks.get(i)} />
          </div>
        ),
      )}
    </>
  );
}

/** One clarification's column: the back arrow (which closes it) and its
 *  passage at its head, its exchange, and — carried on — a box at its
 *  foot. */
function ThreadColumn({
  chat,
  thread,
  index,
  marks,
  continuable,
  onBack,
}: {
  chat: Chat;
  thread: ChatThread;
  index: number;
  marks: Map<number, ThreadMark[]>;
  continuable: boolean;
  onBack: () => void;
}) {
  const key = threadKey(chat.id, thread.id);
  const busy = useThreadBusy((s) => Boolean(s.busy[key]));
  const failed = useThreadBusy((s) => s.failed[key]);
  const [draft, setDraft] = useState("");
  const waiting = unanswered(thread);
  const send = () => {
    if (continueThread(chat.id, thread.id, draft)) setDraft("");
  };
  return (
    <div className="thread-col thread-col-sub" data-col={index} data-thread={thread.id}>
      <div className="thread-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back" title="Back — close this clarification">
          <ArrowLeftIcon size={12} />
        </button>
        <span className="thread-quote" title={thread.quote}>
          “{thread.quote}”
        </span>
      </div>
      <Messages messages={thread.messages} source={chat.source} marks={marks} />
      {busy && (
        <div className="chat-msg chat-msg-assistant">
          <div className="chat-msg-body chat-thinking">
            <Spinner size={13} /> thinking…
          </div>
        </div>
      )}
      {waiting && !busy && (
        <div className="error-msg">
          {failed ?? "Not answered."}{" "}
          <button className="link-btn" onClick={() => retryThread(chat.id, thread.id)}>
            Try again
          </button>
        </div>
      )}
      {continuable && !waiting && (
        <textarea
          className="thread-compose"
          rows={2}
          value={draft}
          placeholder="Continue this thread…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline, as below.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
      )}
    </div>
  );
}

export function ThreadStrip({
  chat,
  continuable,
  scrollRef,
  rootBefore,
  rootAfter,
  hideQuestion = false,
  className = "",
  onColumns,
}: {
  chat: Chat;
  continuable: boolean;
  /** The strip, for the host to follow the conversation with. */
  scrollRef?: RefObject<HTMLDivElement>;
  /** In the first column, before and after the conversation's messages. */
  rootBefore?: ReactNode;
  rootAfter?: ReactNode;
  hideQuestion?: boolean;
  className?: string;
  /** How many columns are open, as it changes (the explainer widens). */
  onColumns?: (n: number) => void;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const stripRef = scrollRef ?? ownRef;
  const [path, setPath] = useState<string[]>([]);
  const [wide, setWide] = useState(false);
  // The column to bring into view once laid out: one just opened, or
  // the one a closed column was asked in.
  const reveal = useRef<number | null>(null);

  // The columns open that are still there: a thread gone (its
  // explainer asked again) closes its column, and those right of it.
  const open = useMemo(() => {
    const out: string[] = [];
    let parent: string | null = null;
    for (const id of path) {
      if (threadOf(chat, id)?.parentId !== parent) break;
      out.push(id);
      parent = id;
    }
    return out;
  }, [path, chat.threads]);
  const columns = useMemo(() => open.map((id) => threadOf(chat, id)!), [open, chat.threads]);
  useEffect(() => onColumns?.(columns.length + 1), [columns.length]);

  // Each column's marks, by the message they are in — the same arrays
  // while the passages and the open column are, so an answer arriving
  // elsewhere doesn't render every answer again (and let go of a
  // selection being made in one).
  const markKey = `${(chat.threads ?? []).map((t) => `${t.id}:${t.parentId}:${t.messageIndex}:${t.start}:${t.end}`).join("|")}#${open.join(",")}`;
  const marks = useMemo(
    () =>
      [null, ...open].map((id, k) => {
        const byMessage = new Map<number, ThreadMark[]>();
        for (const t of threadsIn(chat, id)) {
          const list = byMessage.get(t.messageIndex) ?? [];
          list.push({ id: t.id, start: t.start, end: t.end, on: open[k] === t.id });
          byMessage.set(t.messageIndex, list);
        }
        return byMessage;
      }),
    [markKey],
  );

  /** Open thread `id` from column `k`, closing those right of it — or,
   *  with null, close the column right of `k`. */
  const openFrom = useCallback(
    (k: number, id: string | null) => {
      setPath(id ? [...open.slice(0, k), id] : open.slice(0, k));
      reveal.current = id ? k + 1 : k;
    },
    [open],
  );

  // Two columns side by side where they fit.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const ro = new ResizeObserver(() => setWide(strip.clientWidth >= TWO_COLUMNS));
    ro.observe(strip);
    return () => ro.disconnect();
  }, [stripRef]);

  // The column to show, scrolled into view sideways.
  useLayoutEffect(() => {
    const k = reveal.current;
    const strip = stripRef.current;
    const col = k === null ? null : strip?.querySelector<HTMLElement>(`:scope > .thread-col[data-col="${k}"]`);
    if (!strip || !col) return;
    reveal.current = null;
    const right = col.offsetLeft + col.offsetWidth;
    let x = strip.scrollLeft;
    if (right > x + strip.clientWidth) x = right - strip.clientWidth;
    if (col.offsetLeft < x) x = col.offsetLeft;
    if (x !== strip.scrollLeft) strip.scrollTo({ left: x, behavior: "smooth" });
  }, [open, wide]);

  const [target, setTarget] = useClarifySelection(stripRef);
  const closeTarget = useCallback(() => setTarget(null), [setTarget]);
  const ask = (question?: string) => {
    if (!target) return;
    const k = target.at.parentId === null ? 0 : open.indexOf(target.at.parentId) + 1;
    const id = startClarify(chat.id, target.at, question);
    setTarget(null);
    if (id && k >= 0) openFrom(k, id);
  };

  // A tap on a marked passage opens its column, or closes it if open.
  const onClick = (e: React.MouseEvent) => {
    const mark = (e.target as Element).closest?.<HTMLElement>("mark.thread-mark[data-thread]");
    if (!mark || !window.getSelection()?.isCollapsed) return;
    const k = Number(mark.closest<HTMLElement>(".thread-col")?.dataset.col ?? -1);
    const id = mark.dataset.thread ?? "";
    if (k < 0 || !id) return;
    openFrom(k, open[k] === id ? null : id);
  };
  // The Clarify bar is placed on the screen, under the passage: a scroll
  // moves the passage from under it, so it goes — unless it is being
  // typed in.
  const onScroll = () => {
    if (target && !document.activeElement?.closest(".clarify-pop")) setTarget(null);
  };

  const classes = ["chat-scroll", "thread-strip", wide ? "wide" : "", columns.length ? "threaded" : "", className];
  return (
    <div className={classes.filter(Boolean).join(" ")} ref={stripRef} onClick={onClick} onScrollCapture={onScroll}>
      <div className="thread-col" data-col={0} data-thread="">
        {rootBefore}
        <Messages messages={chat.messages} source={chat.source} marks={marks[0]} hideFirst={hideQuestion} />
        {rootAfter}
      </div>
      {columns.map((t, i) => (
        <ThreadColumn
          key={t.id}
          chat={chat}
          thread={t}
          index={i + 1}
          marks={marks[i + 1]}
          continuable={continuable}
          onBack={() => openFrom(i, null)}
        />
      ))}
      {target && <ClarifyPopover target={target} onAsk={ask} onClose={closeTarget} />}
    </div>
  );
}
