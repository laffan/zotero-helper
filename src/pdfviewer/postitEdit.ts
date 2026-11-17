// A post-it's menu and its text editor (postits.ts).
//
// The menu opens from a tap on the paper's grip — the darker band across
// its top, which a drag moves it by — above the paper: the paper's
// colours, Type (the editor, for a hand that holds only the Pencil) and
// Delete, which a second press confirms. A colour, Type, a press
// elsewhere, Escape or a scroll of the pages closes it.
//
// The editor opens on a double-tap of a finger on the paper, a
// double-click, or Type: a bare textarea over the paper below its grip,
// in the paper's own face and size, with the words raw. Escape or ⌘↩
// ends it, and so do a press anywhere else, the focus leaving it (150ms
// on, as the notepad's text notes do) and the app being put away — the
// words kept each time.
import { POSTIT_COLORS } from "../lib/postits";

export interface PostItMenuOpen {
  /** The post-it. */
  anchor: HTMLElement;
  color: string;
  setColor: (c: string) => void;
  type: () => void;
  remove: () => void;
}

/** Act on the release of a finger's or the Pencil's press, as the
 *  selection bar's buttons do (a click the iPad may swallow), and on a
 *  mouse's click. */
function onPress(btn: HTMLElement, fn: () => void): void {
  let touch = false;
  btn.addEventListener("pointerdown", (e) => (touch = e.pointerType !== "mouse"));
  btn.addEventListener("pointerup", (e) => {
    if (!touch || e.pointerType === "mouse") return;
    touch = false;
    e.preventDefault();
    fn();
  });
  btn.addEventListener("click", () => {
    if (!touch) fn();
    touch = false;
  });
}

export function createPostItMenu(host: HTMLElement, scrollArea: HTMLElement) {
  let menu: HTMLElement | null = null;

  function close(): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    scrollArea.removeEventListener("scroll", close);
  }
  function onOutside(e: PointerEvent): void {
    const t = e.target as Element;
    if (menu && !menu.contains(t) && !t.closest?.(".pdf-postit-grip")) close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    // Before reading mode's own Escape, which would leave it.
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  function open(o: PostItMenuOpen): void {
    close();
    const m = document.createElement("div");
    m.className = "pdf-postit-menu";
    m.setAttribute("role", "menu");
    for (const c of POSTIT_COLORS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = c.color === o.color ? "pdf-postit-swatch on" : "pdf-postit-swatch";
      b.style.setProperty("--swatch", c.color);
      b.title = c.name;
      b.setAttribute("aria-label", c.name);
      onPress(b, () => {
        close();
        o.setColor(c.color);
      });
      m.appendChild(b);
    }
    const type = document.createElement("button");
    type.type = "button";
    type.className = "pdf-postit-action";
    type.textContent = "Type";
    type.title = "Type on the post-it (or double-tap it)";
    onPress(type, () => {
      close();
      o.type();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "pdf-postit-action pdf-postit-delete";
    del.textContent = "Delete";
    onPress(del, () => {
      if (!del.classList.contains("confirm")) {
        del.classList.add("confirm");
        del.textContent = "Delete?";
        return;
      }
      close();
      o.remove();
    });
    m.append(type, del);
    host.appendChild(m);
    menu = m;
    // Above the paper (clear of its words), or under it where there is
    // no room above; kept inside the viewer.
    const h = host.getBoundingClientRect();
    const a = o.anchor.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(a.left - h.left, h.width - m.offsetWidth - 8))}px`;
    const above = a.top - h.top - m.offsetHeight - 6;
    m.style.top = `${above >= 8 ? above : Math.min(a.bottom - h.top + 6, h.height - m.offsetHeight - 8)}px`;
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    scrollArea.addEventListener("scroll", close, { passive: true });
  }

  return { open, close, isOpen: () => menu !== null };
}

export interface PostItEditing {
  id: string;
  el: HTMLElement;
  text: string;
  /** The editing ended: the words as they are now. */
  done: (text: string) => void;
}

export function createPostItEditor() {
  const ta = document.createElement("textarea");
  ta.className = "pdf-postit-editor";
  ta.setAttribute("aria-label", "Post-it text");
  let open: PostItEditing | null = null;
  // Which opening of the editor a blur belongs to.
  let session = 0;

  function focus(): void {
    try {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch {
      /* gone meanwhile */
    }
  }

  /** End the editing, keeping the words. */
  function commit(): void {
    const o = open;
    if (!o) return;
    open = null;
    session++;
    o.el.classList.remove("editing");
    ta.remove();
    o.done(ta.value.replace(/\s+$/, ""));
  }

  function begin(o: PostItEditing): void {
    commit();
    open = o;
    session++;
    ta.value = o.text;
    o.el.classList.add("editing");
    o.el.appendChild(ta);
    // Now, while the tap is being handled, so iPadOS raises its keyboard;
    // and again a moment later, should the press's own default have
    // taken the focus back.
    focus();
    window.setTimeout(() => open === o && document.activeElement !== ta && focus(), 20);
  }

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
      e.preventDefault();
      e.stopPropagation();
      commit();
    }
  });
  ta.addEventListener("blur", () => {
    const s = session;
    window.setTimeout(() => open && session === s && document.activeElement !== ta && commit(), 150);
  });
  // A press anywhere else ends it.
  const pressed = (e: PointerEvent) => {
    if (open && !ta.contains(e.target as Node)) commit();
  };
  window.addEventListener("pointerdown", pressed, true);
  const hidden = () => document.visibilityState === "hidden" && commit();
  document.addEventListener("visibilitychange", hidden);

  return {
    begin,
    commit,
    editing: (id: string): boolean => open?.id === id,
    isOpen: () => open !== null,
    destroy(): void {
      commit();
      window.removeEventListener("pointerdown", pressed, true);
      document.removeEventListener("visibilitychange", hidden);
    },
  };
}
