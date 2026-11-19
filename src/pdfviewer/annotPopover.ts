// The popover for one annotation: its colour, its comment, the
// selection bar's icons — Copy, Add to notes, and with an AI service
// connected Look up (the definition shows above the popover) and
// Explain (the explainer's window, about the annotation's text) — and
// Delete. It opens on a tap on a highlight or underline in
// the pages, with handles on the passage to change its extent
// (highlightHandles.ts, through onOpen / onClose) — above the passage,
// or below it when there is no room above, never over its words or
// either handle, so both ends can be grabbed while it is open. Changes
// go out as they are made — a colour at once, the comment after a pause
// in typing and when the popover closes. Where the highlight lies under
// a passage the AI explained, its Explain opens that explanation; under
// a word looked up, the word's definition shows over it.
import { copyText } from "../lib/clipboard";
import { ANNOTATION_COLORS, colorLetter, type Annotation } from "../lib/highlights";
import { COPY_ICON, LOOKUP_ICON, NOTE_ICON, SPARKLES_ICON } from "./icons";
import { createLookupPopup } from "./lookupPopup";

export interface AnnotationEditHandlers {
  update: (key: string, patch: { color?: string; comment?: string }) => void;
  remove: (key: string) => void;
  /** Send the annotation to the notes; absent hides the button. */
  onInsert?: (a: Annotation) => void;
  /** Look the annotation's text up; shown while `canLookup`. */
  onLookup?: (a: Annotation) => Promise<string>;
  /** Have the annotation's text explained, as the selection bar's
   *  Explain does a selection's; shown, as Look up is, while
   *  `canLookup`. */
  onExplain?: (a: Annotation) => void;
  /** Open an explanation made before, by its id: one of a passage the
   *  highlight overlaps (`open`'s `extras`). */
  onOpenExplanation?: (id: string) => void;
  canLookup?: () => boolean;
  /** It opened on `a`, and it closed. */
  onOpen?: (a: Annotation) => void;
  onClose?: () => void;
}

/** What else is under the tap that opens the editor: an explained
 *  passage (its id) and a word looked up (its definition). */
export interface OpenExtras {
  explanation?: string | null;
  definition?: { word: string; text: string } | null;
}

const COMMENT_PAUSE_MS = 700;
/** Room between the passage and the editor, CSS px: the handles' knobs
 *  stand 9px past the line, and a finger needs more round them than a
 *  pointer does. */
const GAP = 16;
const TOUCH_GAP = 30;
const fingers = () =>
  document.documentElement.classList.contains("ipados") || window.matchMedia?.("(pointer: coarse)").matches;

/** `area`: the part of the viewer the pages show in (the editor stays
 *  inside it); the whole of `root` when absent. */
export function createAnnotationPopover(root: HTMLElement, handlers: AnnotationEditHandlers, area?: HTMLElement) {
  const el = document.createElement("div");
  el.className = "pdf-annot-popover";
  el.style.display = "none";
  root.appendChild(el);

  const colors = document.createElement("div");
  colors.className = "pdf-annot-popover-colors";
  el.appendChild(colors);
  const comment = document.createElement("textarea");
  comment.className = "pdf-annot-popover-comment";
  comment.placeholder = "Add a comment…";
  comment.rows = 3;
  el.appendChild(comment);
  const footer = document.createElement("div");
  footer.className = "pdf-annot-popover-footer";
  el.appendChild(footer);
  const icon = (svg: string, title: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pdf-selection-icon";
    b.title = title;
    b.innerHTML = svg;
    footer.appendChild(b);
    return b;
  };
  const copy = icon(COPY_ICON, "Copy");
  const insert = icon(NOTE_ICON, "Add to notes — a quote with a link back to the page");
  const lookup = icon(LOOKUP_ICON, "Look up — a short definition");
  const explain = icon(SPARKLES_ICON, "Ask the AI to explain this passage");
  explain.className = "pdf-selection-explain";
  const definition = createLookupPopup(root);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "pdf-annot-popover-delete";
  footer.appendChild(del);

  let current: Annotation | null = null;
  let committed = "";
  let commentTimer = 0;
  let armTimer = 0;

  const swatches = ANNOTATION_COLORS.map((color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pdf-mark-swatch";
    b.style.setProperty("--swatch", color);
    b.dataset.letter = colorLetter(color);
    b.addEventListener("click", () => {
      if (!current) return;
      handlers.update(current.key, { color });
      current = { ...current, color };
      paintColors();
    });
    colors.appendChild(b);
    return b;
  });

  function paintColors(): void {
    swatches.forEach((s, i) => s.classList.toggle("active", current?.color === ANNOTATION_COLORS[i]));
  }

  function commitComment(): void {
    clearTimeout(commentTimer);
    if (!current || comment.value === committed) return;
    committed = comment.value;
    handlers.update(current.key, { comment: committed });
  }
  comment.addEventListener("input", () => {
    clearTimeout(commentTimer);
    commentTimer = window.setTimeout(commitComment, COMMENT_PAUSE_MS);
  });
  comment.addEventListener("blur", commitComment);
  comment.addEventListener("keydown", (e) => {
    // Keep ← / → and the viewer's shortcuts out of the page behind.
    e.stopPropagation();
    if (e.key === "Escape") close();
  });

  insert.addEventListener("click", () => {
    if (current) handlers.onInsert?.(current);
    close();
  });
  // Copy says whether it worked — the button's title and a mark on it —
  // and leaves the editor open.
  let copyTimer = 0;
  copy.addEventListener("click", () => {
    if (!current) return;
    clearTimeout(copyTimer);
    void copyText(current.text).then((ok) => {
      copy.classList.toggle("copied", ok);
      copy.classList.toggle("copy-failed", !ok);
      copy.dataset.flash = ok ? "Copied" : "Couldn't copy";
      copyTimer = window.setTimeout(() => {
        copy.classList.remove("copied", "copy-failed");
        delete copy.dataset.flash;
      }, 1400);
    });
  });
  lookup.addEventListener("click", () => {
    if (!current || !handlers.onLookup) return;
    definition.show(current.text, handlers.onLookup(current), el.getBoundingClientRect());
  });
  // An explained passage under the tap: Explain opens it, rather than
  // asking about the highlight's text anew.
  let explanation: string | null = null;
  explain.addEventListener("click", () => {
    const a = current;
    const id = explanation;
    close();
    if (id) handlers.onOpenExplanation?.(id);
    else if (a) handlers.onExplain?.(a);
  });

  // Delete asks once more before it goes: a second press within a few
  // seconds confirms.
  function disarm(): void {
    clearTimeout(armTimer);
    del.classList.remove("armed");
    del.textContent = "Delete";
  }
  del.addEventListener("click", () => {
    if (!current) return;
    if (!del.classList.contains("armed")) {
      del.classList.add("armed");
      del.textContent = "Delete — sure?";
      armTimer = window.setTimeout(disarm, 3000);
      return;
    }
    const key = current.key;
    current = null;
    close();
    handlers.remove(key);
  });

  /** Open for `a`, whose passage is `anchor` (client coordinates):
   *  above it, clear of the knob over its start, so neither the words
   *  nor either handle is covered; below it, clear of the end's knob,
   *  when there is no room above; and where neither has room (a passage
   *  as tall as the view), on the side with more. Kept inside `area`,
   *  the part of the viewer the pages show in. */
  function open(a: Annotation, anchor: DOMRect, extras: OpenExtras = {}): void {
    if (current) commitComment();
    current = a;
    committed = a.comment;
    comment.value = a.comment;
    disarm();
    paintColors();
    insert.style.display = handlers.onInsert && a.text ? "" : "none";
    copy.style.display = a.text ? "" : "none";
    const ai = Boolean(a.text) && handlers.canLookup?.() !== false;
    lookup.style.display = handlers.onLookup && ai ? "" : "none";
    explanation = (handlers.onOpenExplanation && extras.explanation) || null;
    explain.style.display = (handlers.onExplain && ai) || explanation ? "" : "none";
    explain.classList.toggle("has-explanation", Boolean(explanation));
    explain.title = explanation ? "Open the explanation of this passage" : "Ask the AI to explain this passage";
    definition.hide();
    el.style.display = "";
    const host = root.getBoundingClientRect();
    const view = (area ?? root).getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = fingers() ? TOUCH_GAP : GAP;
    const minTop = view.top - host.top + 8;
    const maxTop = view.bottom - host.top - h - 8;
    const above = anchor.top - host.top - gap - h;
    const below = anchor.bottom - host.top + gap;
    let top: number;
    if (above >= minTop) top = above;
    else if (below <= maxTop) top = below;
    else top = anchor.top - view.top > view.bottom - anchor.bottom ? minTop : maxTop;
    const left = anchor.left - host.left + anchor.width / 2 - w / 2;
    el.style.left = `${Math.max(8, Math.min(left, host.width - w - 8))}px`;
    el.style.top = `${Math.max(minTop, Math.min(top, maxTop))}px`;
    // A word looked up under the tap: its definition, over the editor.
    if (extras.definition) definition.showKnown(extras.definition.word, extras.definition.text, el.getBoundingClientRect());
    handlers.onOpen?.(a);
  }

  function close(): void {
    commitComment();
    disarm();
    current = null;
    // Hidden, the comment would keep the focus (WebKit), and with it
    // every key.
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    el.style.display = "none";
    definition.hide();
    handlers.onClose?.();
  }

  // A press anywhere else closes it — but on the passage's handles,
  // which belong to it; so does Escape.
  const onDown = (e: PointerEvent) => {
    const t = e.target as Element;
    if (current && !el.contains(t) && !t.closest?.(".pdf-annot-handle, .pdf-lookup")) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (current && e.key === "Escape") close();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);

  return {
    open,
    close,
    isOpen: () => current !== null,
    /** Annotations changed (a sync, an edit): follow this one's new
     *  version, or close if it is gone. */
    sync(list: Annotation[]): void {
      if (!current) return;
      const fresh = list.find((a) => a.key === current!.key);
      if (fresh) current = fresh;
      else {
        current = null;
        close();
      }
    },
    destroy(): void {
      close();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      el.remove();
      definition.destroy();
    },
  };
}
