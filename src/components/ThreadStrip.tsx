// The strip a conversation is read in (ChatPanel.tsx) — an explainer's
// too (ExplainChat.tsx): its own messages in the first column, and to
// the right, a column for each clarification open (lib/ai/threads.ts).
//
// A passage of an answer selected and asked about (ClarifyPopover.tsx)
// is answered in a new column right of the one it was asked in, its head
// level with the passage: the columns share one vertical scroll, and
// each is pushed down to where its passage is in the column before
// (`tops`, measured after every layout and as the columns resize). The
// passages asked about stay marked in their answers (threadMarks.ts),
// the one whose column is open more strongly; a tap on one opens its
// column, or closes it if open. One column is open to the right of
// each, so the open ones are a path — the conversation, a clarification
// of it, a clarification of that — and opening another from a column
// closes those right of it. The strip scrolls sideways between them,
// snapping to a column's edge; a new column is scrolled into view, and
// its head's back arrow scrolls to the one it was asked in. Each column
// is the strip's width when the strip is narrow (the details panel, the
// explainer), half of it when there is room for two.
//
// `continuable`: a clarification has a box at its foot to carry it on (a
// Questions conversation); an explainer's are answered and that's all.
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
  removeThread,
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
import { ArrowLeftIcon, CloseIcon, Spinner, TrashIcon } from "./Icons";

/** A column's padding at its top, px (threads.css): a column is pushed
 *  down so its head, under the padding, is level with its passage. */
const PAD = 10;
/** Wide enough for two columns side by side, px. */
const TWO_COLUMNS = 640;

/** The strip scrolled to its first column's foot — the conversation's
 *  latest — and back to its left edge. */
export function followRoot(strip: HTMLElement): void {
  const root = strip.querySelector<HTMLElement>(".thread-col");
  if (!root) return;
  strip.scrollLeft = 0;
  strip.scrollTop = Math.max(0, root.offsetTop + root.offsetHeight - strip.clientHeight);
}

/** A column's messages, each where a selection can find it. The
 *  question the Clarify button asked (`display` "") isn't shown. */
function Messages({
  messages,
  source,
  marks,
}: {
  messages: ChatMessage[];
  source: ChatSource;
  marks: Map<number, ThreadMark[]>;
}) {
  return (
    <>
      {messages.map((m, i) =>
        m.role === "user" && m.display === "" ? null : (
          <div className="thread-msg" data-index={i} key={i}>
            <Bubble role={m.role} content={m.display ?? m.content} source={source} marks={marks.get(i)} />
          </div>
        ),
      )}
    </>
  );
}

/** One clarification's column: its passage at its head, its exchange,
 *  and — carried on — a box at its foot. */
function ThreadColumn({
  chat,
  thread,
  index,
  top,
  marks,
  continuable,
  onBack,
  onClose,
}: {
  chat: Chat;
  thread: ChatThread;
  index: number;
  top: number;
  marks: Map<number, ThreadMark[]>;
  continuable: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const key = threadKey(chat.id, thread.id);
  const busy = useThreadBusy((s) => Boolean(s.busy[key]));
  const failed = useThreadBusy((s) => s.failed[key]);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirm]);
  const waiting = unanswered(thread);
  const send = () => {
    if (continueThread(chat.id, thread.id, draft)) setDraft("");
  };
  return (
    <div className="thread-col thread-col-sub" data-col={index} data-thread={thread.id} style={{ marginTop: top }}>
      <div className="thread-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to where it was asked" title="Back to where it was asked">
          <ArrowLeftIcon size={12} />
        </button>
        <span className="thread-quote" title={thread.quote}>
          “{thread.quote}”
        </span>
        <button
          className={confirm ? "icon-btn thread-delete confirm" : "icon-btn thread-delete"}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            removeThread(chat.id, thread.id);
          }}
          aria-label="Delete this clarification"
          title={confirm ? "Press again to delete it, and the clarifications asked in it" : "Delete this clarification"}
        >
          <TrashIcon size={12} />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close — it stays marked where it was asked">
          <CloseIcon size={11} />
        </button>
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
  className?: string;
  /** How many columns are open, as it changes (the explainer widens). */
  onColumns?: (n: number) => void;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const stripRef = scrollRef ?? ownRef;
  const colsRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [wide, setWide] = useState(false);
  const [tops, setTops] = useState<number[]>([]);
  const reveal = useRef<string | null>(null);

  // The columns open that are still there: a thread removed closes its
  // column, and those right of it.
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

  /** Open thread `id` from column `k`, closing those right of it. */
  const openFrom = useCallback(
    (k: number, id: string | null) => {
      setPath(id ? [...open.slice(0, k), id] : open.slice(0, k));
      reveal.current = id;
    },
    [open],
  );

  // Where each column starts: its passage's height in the column before,
  // that column's own start added.
  const measure = useCallback(() => {
    const cols = colsRef.current;
    const strip = stripRef.current;
    if (!cols || !strip) return;
    setWide(strip.clientWidth >= TWO_COLUMNS);
    const els = [...cols.querySelectorAll<HTMLElement>(":scope > .thread-col")];
    const next = [0];
    for (let k = 1; k < els.length; k++) {
      const id = els[k].dataset.thread ?? "";
      const mark = els[k - 1].querySelector<HTMLElement>(`mark.thread-mark[data-thread="${CSS.escape(id)}"]`);
      const rel = mark ? mark.getBoundingClientRect().top - els[k - 1].getBoundingClientRect().top : PAD;
      next.push(Math.max(0, next[k - 1] + rel - PAD));
    }
    setTops((was) => (was.length === next.length && was.every((v, i) => Math.abs(v - next[i]) < 0.5) ? was : next));
  }, [stripRef]);
  useLayoutEffect(measure);
  useEffect(() => {
    const cols = colsRef.current;
    if (!cols || !stripRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stripRef.current);
    for (const el of cols.querySelectorAll(":scope > .thread-col")) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, columns.length]);

  // A column just opened is scrolled into view, sideways.
  useLayoutEffect(() => {
    const id = reveal.current;
    const strip = stripRef.current;
    const col = id ? colsRef.current?.querySelector<HTMLElement>(`.thread-col[data-thread="${CSS.escape(id)}"]`) : null;
    if (!strip || !col) return;
    reveal.current = null;
    const right = col.offsetLeft + col.offsetWidth;
    let x = strip.scrollLeft;
    if (right > x + strip.clientWidth) x = right - strip.clientWidth;
    if (col.offsetLeft < x) x = col.offsetLeft;
    if (x !== strip.scrollLeft) strip.scrollTo({ left: x, behavior: "smooth" });
  }, [open]);

  /** Scroll to column `k` (the back arrow's way to where it was asked). */
  const scrollToColumn = (k: number) => {
    const strip = stripRef.current;
    const col = colsRef.current?.querySelector<HTMLElement>(`.thread-col[data-col="${k}"]`);
    if (strip && col) strip.scrollTo({ left: col.offsetLeft, behavior: "smooth" });
  };

  const [target, setTarget] = useClarifySelection(colsRef);
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

  const classes = ["chat-scroll", "thread-strip", wide ? "wide" : "", columns.length ? "threaded" : "", className];
  return (
    <div className={classes.filter(Boolean).join(" ")} ref={stripRef}>
      <div className="thread-cols" ref={colsRef} onClick={onClick}>
        <div className="thread-col" data-col={0} data-thread="">
          {rootBefore}
          <Messages messages={chat.messages} source={chat.source} marks={marks[0]} />
          {rootAfter}
        </div>
        {columns.map((t, i) => (
          <ThreadColumn
            key={t.id}
            chat={chat}
            thread={t}
            index={i + 1}
            top={tops[i + 1] ?? 0}
            marks={marks[i + 1]}
            continuable={continuable}
            onBack={() => scrollToColumn(i)}
            onClose={() => openFrom(i, null)}
          />
        ))}
        {target && stripRef.current && (
          <ClarifyPopover target={target} strip={stripRef.current} onAsk={ask} onClose={closeTarget} />
        )}
      </div>
    </div>
  );
}
