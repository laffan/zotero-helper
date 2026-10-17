// Settings → AI → Prompts: the words the reader's AI features ask with
// (lib/ai/prompts.ts) — the explainer's first question and the
// look-up's — each a line of text with tokens in it for what is filled
// in as it is sent: the selection, and the work's title, authors and
// year. A token is a chip in the text: dragged in from the row beneath
// (a pointer drag, which works with a finger on the iPad as HTML5
// drag-and-drop doesn't), or tapped to go in at the caret; Backspace
// takes one out like a character. Changes apply at once, outside the
// Save of the rest of the settings, as they are this device's alone.
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROMPTS,
  PROMPT_FEATURES,
  PROMPT_TOKENS,
  promptTemplate,
  usePrompts,
  type PromptFeature,
} from "../../lib/ai/prompts";

const label = (id: string) => PROMPT_TOKENS.find((t) => t.id === id)?.label ?? id;

function chip(id: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "prompt-token";
  el.contentEditable = "false";
  el.dataset.token = id;
  el.textContent = label(id);
  return el;
}

/** The editor's content, from a template. */
function render(editor: HTMLElement, template: string): void {
  editor.replaceChildren();
  const re = /\{(\w+)\}/g;
  let at = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > at) editor.append(template.slice(at, m.index));
    editor.append(PROMPT_TOKENS.some((t) => t.id === m![1]) ? chip(m[1]) : m[0]);
    at = m.index + m[0].length;
  }
  if (at < template.length) editor.append(template.slice(at));
}

/** A template, from the editor's content. */
function serialize(editor: HTMLElement): string {
  let out = "";
  const walk = (n: Node) => {
    if (n instanceof HTMLElement && n.dataset.token) out += `{${n.dataset.token}}`;
    else if (n instanceof Text) out += n.data;
    else if (n instanceof HTMLBRElement) out += " ";
    else n.childNodes.forEach(walk);
  };
  editor.childNodes.forEach(walk);
  return out.replace(/\s+/g, " ").trim();
}

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** A collapsed range at a point, if it falls inside `editor`. */
function caretIn(editor: HTMLElement, x: number, y: number): Range | null {
  const doc = document as CaretDoc;
  let r: Range | null = null;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
    }
  } else r = doc.caretRangeFromPoint?.(x, y) ?? null;
  return r && editor.contains(r.startContainer) ? r : null;
}

function PromptEditor({ feature }: { feature: PromptFeature }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const [version, setVersion] = useState(0);
  const custom = usePrompts((s) => feature in s.prompts);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (editorRef.current) render(editorRef.current, promptTemplate(feature));
  }, [feature, version]);

  const commit = () => {
    const editor = editorRef.current;
    if (editor) usePrompts.getState().setPrompt(feature, serialize(editor));
  };

  // Where a token tapped in the row goes: the caret, last it was here.
  useEffect(() => {
    const keep = () => {
      const sel = document.getSelection();
      const editor = editorRef.current;
      if (sel?.rangeCount && editor?.contains(sel.anchorNode)) caret.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", keep);
    return () => document.removeEventListener("selectionchange", keep);
  }, []);

  const insert = (id: string, at: Range | null) => {
    const editor = editorRef.current;
    if (!editor) return;
    const node = chip(id);
    const space = document.createTextNode(" ");
    if (at && editor.contains(at.startContainer)) {
      at.collapse(true);
      at.insertNode(space);
      at.insertNode(node);
    } else editor.append(" ", node, space);
    commit();
  };

  const startDrag = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 4;
      if (moved) setDrag({ id, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      const editor = editorRef.current;
      if (!editor) return;
      if (!moved) return insert(id, caret.current);
      const r = editor.getBoundingClientRect();
      const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (over) insert(id, caretIn(editor, ev.clientX, ev.clientY));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const info = PROMPT_FEATURES.find((f) => f.id === feature)!;
  return (
    <div className="prompt-field">
      <div className="prompt-field-head">
        <span>{info.label}</span>
        {custom && (
          <button
            className="link-btn"
            onClick={() => {
              usePrompts.getState().setPrompt(feature, null);
              setVersion((v) => v + 1);
            }}
            title={`Back to “${DEFAULT_PROMPTS[feature]}”`}
          >
            Reset
          </button>
        )}
      </div>
      <div
        ref={editorRef}
        className="prompt-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`${info.label} prompt`}
        onInput={commit}
        onKeyDown={(e) => {
          // One line: Return is done.
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          }
        }}
      />
      <div className="prompt-tokens">
        {PROMPT_TOKENS.map((t) => (
          <span
            key={t.id}
            className="prompt-token"
            onPointerDown={(e) => startDrag(t.id, e)}
            title="Drag into the prompt, or tap to put it at the caret"
          >
            {t.label}
          </span>
        ))}
      </div>
      <p className="hint">{info.hint}</p>
      {drag && (
        <span className="prompt-token prompt-token-ghost" style={{ left: drag.x, top: drag.y }}>
          {label(drag.id)}
        </span>
      )}
    </div>
  );
}

export function PromptSettings() {
  return (
    <div className="prompt-settings">
      <h3 className="settings-subhead">Prompts</h3>
      <p className="hint">
        What the reader's AI tools ask. Drag a token into a prompt for what is filled in as it is sent — the selection, or
        the work's title, authors and year. These apply at once, on this device.
      </p>
      {PROMPT_FEATURES.map((f) => (
        <PromptEditor key={f.id} feature={f.id} />
      ))}
    </div>
  );
}
