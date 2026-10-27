// The links on the notepad (surface.ts): chips dragged onto the pad from
// the pages — a link icon and the page, or the whole of a highlight's
// text beside a bar in its colour and its page, faintly. A chip is
// dragged to move it, tapped to go there, and held (or right-clicked)
// for a small menu with Delete. A highlight's quote is also sized: a
// small dotted circle at its lower right (the floating pad's own grip,
// smaller) drags its width and height, the text wrapping to the width
// and clipped at the height.
//
// The menu sits on the canvas, whose touches are cancelled so a finger
// pans it (surface.ts `stopTouch`) — which also cancels the click a tap
// would end in, so the menu's buttons act on the press's release.
import { linkLabel, type NoteLink } from "./model";

/** How long a press on a link is held for its menu, ms. */
const HOLD_MS = 550;
/** CSS px within which a press is a tap. */
const TAP_PX = 6;
/** A quote's smallest and largest size, CSS px. */
const MIN_W = 90;
const MAX_W = 640;
const MIN_H = 24;

const LINK_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-1 1"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l1-1"/></svg>`;
export const TRASH_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11"/><path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg>`;

/** Keep a pointer's events coming to `el`, if it is still there. */
export function capture(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the pointer is already gone */
  }
}

/** A button that acts on the release of a press on it (or a click,
 *  from the keyboard) — never twice for one press. */
export function onPress(btn: HTMLElement, act: () => void): void {
  let pressed = false;
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    pressed = true;
  });
  btn.addEventListener("pointerup", (e) => {
    if (!pressed) return;
    pressed = false;
    e.preventDefault();
    act();
  });
  btn.addEventListener("pointercancel", () => (pressed = false));
  btn.addEventListener("click", (e) => {
    // A click after the release just handled, or a keyboard's.
    if (e.detail === 0) act();
  });
}

export interface LinkChipEnv {
  /** A link moved or was sized: save. */
  changed: () => void;
  goTo: (l: NoteLink) => void;
  remove: (l: NoteLink) => void;
}

export function createLinkChips(host: HTMLElement, env: LinkChipEnv) {
  let menu: { el: HTMLElement; off: () => void } | null = null;

  function closeMenu(): void {
    menu?.off();
    menu?.el.remove();
    menu = null;
  }

  /** Under the link (above it near the pad's foot): Delete. */
  function linkMenu(l: NoteLink, chip: HTMLElement): void {
    closeMenu();
    const el = document.createElement("div");
    el.className = "notepad-link-menu";
    const del = document.createElement("button");
    del.type = "button";
    del.innerHTML = `${TRASH_SVG}<span>Delete</span>`;
    onPress(del, () => {
      closeMenu();
      env.remove(l);
    });
    el.appendChild(del);
    // Its own presses aren't the canvas's.
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    host.appendChild(el);
    const hr = host.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    const below = cr.bottom - hr.top + 6;
    el.style.left = `${Math.max(6, Math.min(cr.left - hr.left, host.clientWidth - el.offsetWidth - 6))}px`;
    el.style.top = `${below + el.offsetHeight > host.clientHeight ? cr.top - hr.top - el.offsetHeight - 6 : below}px`;
    // Any press elsewhere closes it.
    const away = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) closeMenu();
    };
    window.setTimeout(() => window.addEventListener("pointerdown", away, true));
    menu = { el, off: () => window.removeEventListener("pointerdown", away, true) };
  }

  /** A quote's size, as kept. */
  function applySize(l: NoteLink, el: HTMLElement): void {
    el.style.width = l.w ? `${l.w}px` : "";
    el.style.height = l.h ? `${l.h}px` : "";
    el.classList.toggle("sized", Boolean(l.w || l.h));
  }

  /** The dotted circle at a quote's lower right: drag to size it. */
  function sizeGrip(l: NoteLink, el: HTMLElement): HTMLElement {
    const grip = document.createElement("span");
    grip.className = "notepad-link-size";
    grip.title = "Drag to size the quote";
    grip.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.pointerType === "mouse" && e.button !== 0) return;
      capture(grip, e.pointerId);
      const from = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight };
      const move = (ev: PointerEvent) => {
        l.w = Math.round(Math.max(MIN_W, Math.min(MAX_W, from.w + ev.clientX - from.x)));
        l.h = Math.round(Math.max(MIN_H, from.h + ev.clientY - from.y));
        applySize(l, el);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        env.changed();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    return grip;
  }

  function chip(l: NoteLink): HTMLElement {
    const quote = l.target.kind === "annotation";
    const el = document.createElement("button");
    el.type = "button";
    el.className = quote ? "notepad-link notepad-link-quote" : "notepad-link";
    el.dataset.link = l.id;
    el.style.left = `${l.x}px`;
    el.style.top = `${l.y}px`;
    if (l.target.kind === "annotation") el.style.setProperty("--link-color", l.target.color || "#ffd400");
    el.innerHTML = LINK_SVG;
    const text = document.createElement("span");
    text.className = "notepad-link-text";
    text.textContent = linkLabel(l.target);
    // A highlight's page after its text, faintly.
    if (l.target.kind === "annotation") {
      const page = document.createElement("span");
      page.className = "notepad-link-page";
      page.textContent = ` p. ${l.target.pageIndex + 1}`;
      text.appendChild(page);
    }
    el.appendChild(text);
    if (quote) {
      el.appendChild(sizeGrip(l, el));
      applySize(l, el);
    }
    el.title = quote ? `Go to the highlight, p. ${l.target.pageIndex + 1}` : `Go to page ${l.target.pageIndex + 1}`;
    // Dragged to move; tapped to go; held, or right-clicked, for its menu.
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      linkMenu(l, el);
    });
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const from = { x: e.clientX, y: e.clientY, lx: l.x, ly: l.y };
      let moved = false;
      let held = false;
      const hold = window.setTimeout(() => {
        held = true;
        linkMenu(l, el);
      }, HOLD_MS);
      capture(el, e.pointerId);
      const move = (ev: PointerEvent) => {
        if (held) return;
        moved ||= Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > TAP_PX;
        if (moved) window.clearTimeout(hold);
        if (!moved) return;
        l.x = from.lx + ev.clientX - from.x;
        l.y = from.ly + ev.clientY - from.y;
        el.style.left = `${l.x}px`;
        el.style.top = `${l.y}px`;
      };
      const up = (ev: PointerEvent) => {
        window.clearTimeout(hold);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (held) return;
        if (moved) env.changed();
        else if (ev.type === "pointerup") env.goTo(l);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    return el;
  }

  return { chip, closeMenu };
}
