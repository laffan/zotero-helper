// The explainer's window: a small conversation about a passage of the
// open PDF, floating over the pages at the bottom right (reading mode
// included) so the passage stays in sight. It opens from the selection
// bar's AI button (lib/ai/explain.ts) and asks its first question by
// itself; after that it is a chat like any other, kept with the entry's
// conversations — × or Escape closes the window, not the conversation,
// and "Open in panel" carries it on in the conversations tab.
import { useEffect, useRef, useState } from "react";
import { sendChatMessage } from "../lib/ai/chat";
import { formatUsd } from "../lib/ai/models";
import { useStore } from "../lib/store";
import { Bubble } from "./ChatPanel";
import { CloseIcon, QuestionIcon, Spinner } from "./Icons";

export function ExplainChat() {
  const explain = useStore((s) => s.explain);
  const chat = useStore((s) => s.chats.find((c) => c.id === s.explain?.chatId));
  const busyId = useStore((s) => s.chatBusy);
  const busy = Boolean(chat) && busyId === chat?.id;
  const readingMode = useStore((s) => s.readingMode);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);

  const close = () => useStore.getState().setExplain(null);

  const send = async (text: string) => {
    if (!chat || !text.trim()) return;
    setError(null);
    try {
      await sendChatMessage(chat.id, text);
    } catch (e) {
      setError(String(e));
      setDraft(text);
    }
  };

  // The first question goes out as the window opens.
  useEffect(() => {
    if (!chat || !explain?.question || chat.messages.length || asked.current === chat.id) return;
    asked.current = chat.id;
    void send(explain.question);
  }, [chat?.id, explain?.question]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, busy]);

  // Escape closes the window before it reaches reading mode's exit.
  useEffect(() => {
    if (!explain) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [explain]);

  if (!explain || !chat) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send(text);
  };

  const openInPanel = () => {
    const s = useStore.getState();
    s.setMetaTab("chats");
    s.selectChat(chat.id);
    close();
  };

  return (
    <div className="explain-chat" role="dialog" aria-label="Explain the passage">
      <div className="explain-head">
        <QuestionIcon size={13} />
        <span className="explain-title" title={chat.title}>
          {chat.title}
        </span>
        {!readingMode && (
          <button className="link-btn" onClick={openInPanel} title="Carry on in the conversations tab">
            Open in panel
          </button>
        )}
        <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc) — the conversation is kept">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="explain-scroll chat-scroll" ref={scrollRef}>
        {chat.messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} source={chat.source} />
        ))}
        {busy && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-body chat-thinking">
              <Spinner size={13} /> thinking…
            </div>
          </div>
        )}
        {error && <div className="error-msg">{error}</div>}
      </div>
      <div className="explain-compose">
        <textarea
          rows={1}
          value={draft}
          placeholder={busy ? "Waiting for the reply…" : "Ask a follow-up…"}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="tool-btn accent" onClick={submit} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
      <div className="explain-meter">{formatUsd(chat.costUsd)} spent</div>
    </div>
  );
}
