// The popover for one annotation: its colour, its comment, "Add to
// notes" and Delete. It opens on a tap on a highlight or underline in
// the pages, and from the pencil on a shelf row. Changes go out as they
// are made — a colour at once, the comment after a pause in typing and
// when the popover closes.
import { ANNOTATION_COLORS, type Annotation } from "../lib/highlights";

export interface AnnotationEditHandlers {
  update: (key: string, patch: { color?: string; comment?: string }) => void;
  remove: (key: string) => void;
  /** Send the annotation to the notes; absent hides the button. */
  onInsert?: (a: Annotation) => void;
}

const COMMENT_PAUSE_MS = 700;

export function createAnnotationPopover(root: HTMLElement, handlers: AnnotationEditHandlers) {
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
  const insert = document.createElement("button");
  insert.type = "button";
  insert.className = "pdf-annot-popover-insert";
  insert.textContent = "Add to notes";
  footer.appendChild(insert);
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

  /** Open for `a`, beside `anchor` (client coordinates): below it, or
   *  to its left (for a shelf row at the viewer's right edge). */
  function open(a: Annotation, anchor: DOMRect, side: "below" | "left" = "below"): void {
    if (current) commitComment();
    current = a;
    committed = a.comment;
    comment.value = a.comment;
    disarm();
    paintColors();
    insert.style.display = handlers.onInsert && a.text ? "" : "none";
    el.style.display = "";
    const host = root.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (side === "left") {
      left = anchor.left - host.left - w - 8;
      top = anchor.top - host.top;
    } else {
      left = anchor.left - host.left + anchor.width / 2 - w / 2;
      top = anchor.bottom - host.top + 8;
      if (top + h > host.height - 8) top = anchor.top - host.top - h - 8;
    }
    el.style.left = `${Math.max(8, Math.min(left, host.width - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(top, host.height - h - 8))}px`;
  }

  function close(): void {
    commitComment();
    disarm();
    current = null;
    el.style.display = "none";
  }

  // A press anywhere else closes it; so does Escape.
  const onDown = (e: PointerEvent) => {
    if (current && !el.contains(e.target as Node)) close();
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
    /** Annotations changed (a sync, an edit): close if this one is gone. */
    sync(list: Annotation[]): void {
      if (current && !list.some((a) => a.key === current!.key)) {
        current = null;
        close();
      }
    },
    destroy(): void {
      close();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      el.remove();
    },
  };
}
