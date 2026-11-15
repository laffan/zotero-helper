// Text notes on the notepad (surface.ts): typed, in Markdown, and set as
// Hush sets a notebook's text shapes (markdown.ts) — no box, 16px type,
// lines 1.3 apart, as wide as their words up to 350px. Each is a link
// (model.ts, `text`) whose target is where in the PDF the reader was
// when it was begun, so it is moved, selected by the lasso, deleted,
// undone, mapped and followed as the pad's other links are; its chip is
// drawn in links.ts, its page small above it, as a handwritten note's
// is.
//
// A double-tap on the bare canvas — two finger taps, or two clicks of
// the mouse — opens an editor there; the Pencil's taps are dots, and
// stay dots. A double-tap on a note opens it (so does its menu's Edit).
// A single tap on a note goes to its place once the double-tap window
// is out; on a task's box it ticks the task, on a link it opens it.
//
// The editor is a textarea at the note's place, the Markdown raw in the
// note's own face and size, as in Hush's inline editor: a blinking bar
// while it is empty, and Hush's ⌘B, ⌘I, ⌘= and ⌘K for bold, italic, a
// highlight and a link. Escape or ⌘↩ ends it, as do a press anywhere
// else on the pad, the editor losing the focus, the view closing and
// the app being put away — the words kept each time. A new note left
// empty is dropped; a note emptied is deleted (undo brings it back).
import type { PagePlace, PlaceTarget } from "../pdfviewer/places";
import { toggleTask } from "./markdown";
import { flushNotepad, newId, type Notepad, type NoteLink } from "./model";

/** How soon, ms, and how near, CSS px, a second tap comes for the two
 *  to be a double-tap. */
const DOUBLE_MS = 400;
const DOUBLE_PX = 24;
/** A note's widest until it is sized (Hush's), CSS px at the UI's font
 *  size; its narrowest, when the view has less room than that. */
const MAX_W = 350;
const MIN_W = 120;
/** Kept clear at the view's right edge, for a new note. */
const EDGE_PX = 12;

export interface TextNotesEnv {
  host: HTMLElement;
  /** The layer that pans with the canvas: the editor sits in it. */
  layer: HTMLElement;
  pad: () => Notepad;
  pan: () => { x: number; y: number };
  /** Where the reader is now: a new note's place. */
  place: () => PagePlace | null;
  chipOf: (id: string) => HTMLElement | undefined;
  /** A new note's words: put it on the pad. */
  add: (l: NoteLink) => void;
  /** A note's words changed. */
  retext: (l: NoteLink, text: string) => void;
  remove: (l: NoteLink) => void;
  goTo: (l: NoteLink) => void;
  openLink: (href: string) => void;
}

/** A note's widest by default: 350px at the UI's font size. */
function maxWidth(): number {
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--font-scale"));
  return MAX_W * (scale > 0 ? scale : 1);
}

/** Blank lines at the start and space at the end go. */
const tidy = (text: string) => text.replace(/^(?:[ \t]*\n)+/, "").trimEnd();

/** Toggle `marker` round the selection, as Hush's editor does: with
 *  nothing selected, a pair with the caret between; round a selection
 *  already wrapped (inside it or just outside), unwrapped; otherwise
 *  wrapped. */
function wrap(ta: HTMLTextAreaElement, marker: string): void {
  const v = ta.value;
  const { selectionStart: start, selectionEnd: end } = ta;
  const n = marker.length;
  const sel = v.slice(start, end);
  let next: string;
  let [a, b] = [start + n, end + n];
  if (start === end) next = v.slice(0, start) + marker + marker + v.slice(end);
  else if (sel.length >= 2 * n && sel.startsWith(marker) && sel.endsWith(marker)) {
    next = v.slice(0, start) + sel.slice(n, -n) + v.slice(end);
    [a, b] = [start, end - 2 * n];
  } else if (v.slice(Math.max(0, start - n), start) === marker && v.slice(end, end + n) === marker) {
    next = v.slice(0, start - n) + sel + v.slice(end + n);
    [a, b] = [start - n, end - n];
  } else next = v.slice(0, start) + marker + sel + marker + v.slice(end);
  ta.value = next;
  ta.setSelectionRange(a, b);
}

/** `[selection](url)`, the url selected to be typed over; with nothing
 *  selected, the caret between the brackets (Hush's ⌘K). */
function linkify(ta: HTMLTextAreaElement): void {
  const v = ta.value;
  const { selectionStart: start, selectionEnd: end } = ta;
  const sel = v.slice(start, end);
  ta.value = `${v.slice(0, start)}[${sel}](url)${v.slice(end)}`;
  if (sel) ta.setSelectionRange(start + sel.length + 3, start + sel.length + 6);
  else ta.setSelectionRange(start + 1, start + 1);
}

interface Editing {
  /** The note on the pad, or null for a new one. */
  link: NoteLink | null;
  x: number;
  y: number;
  target: PlaceTarget;
  w?: number;
}

export function createTextNotes(env: TextNotesEnv) {
  const ta = document.createElement("textarea");
  ta.className = "notepad-text-editor";
  ta.setAttribute("aria-label", "Text note, in Markdown");
  let open: Editing | null = null;
  // Which opening of the editor a blur belongs to.
  let session = 0;

  /** As tall as its lines; a blinking bar while it is empty. */
  function fit(): void {
    ta.classList.toggle("empty", !ta.value);
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function focus(): void {
    try {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch {
      /* gone meanwhile */
    }
  }

  function begin(o: Editing, text: string): void {
    commit();
    open = o;
    session++;
    ta.value = text;
    Object.assign(ta.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w ?? maxWidth()}px` });
    env.layer.appendChild(ta);
    if (o.link) env.chipOf(o.link.id)?.classList.add("editing");
    fit();
    // Now, while the tap is being handled, so iPadOS raises its keyboard;
    // and again a moment later, should the press's own default have
    // taken the focus back.
    focus();
    window.setTimeout(() => open === o && document.activeElement !== ta && focus(), 20);
  }

  /** A new note, its top left at a client point. */
  function create(cx: number, cy: number): void {
    const r = env.host.getBoundingClientRect();
    const pan = env.pan();
    const p = env.place();
    const room = r.right - cx - EDGE_PX;
    begin(
      {
        link: null,
        x: Math.round(cx - r.left - pan.x),
        y: Math.round(cy - r.top - pan.y),
        target: { kind: "place", pageIndex: p?.pageIndex ?? 0, top: p?.top ?? null },
        // Wrapped to the room the view has, when that is less.
        w: room < maxWidth() ? Math.round(Math.max(MIN_W, room)) : undefined,
      },
      "",
    );
  }

  function edit(l: NoteLink): void {
    if (open?.link !== l) begin({ link: l, x: l.x, y: l.y, target: l.target, w: l.w }, l.text ?? "");
  }

  /** End the editing, keeping the words. */
  function commit(): void {
    const o = open;
    if (!o) return;
    open = null;
    session++;
    const text = tidy(ta.value);
    ta.remove();
    if (!o.link) {
      if (text) env.add({ id: newId("text"), x: o.x, y: o.y, target: o.target, text, ...(o.w ? { w: o.w } : {}) });
      return;
    }
    env.chipOf(o.link.id)?.classList.remove("editing");
    // Taken off the pad meanwhile (in another view): nowhere to keep it.
    if (!env.pad().links.includes(o.link)) return;
    if (!text) env.remove(o.link);
    else if (text !== o.link.text) env.retext(o.link, text);
  }

  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" || (mod && e.key === "Enter")) {
      // Before reading mode's own Escape, which would leave it.
      e.preventDefault();
      e.stopPropagation();
      commit();
      return;
    }
    if (!mod || e.altKey || e.shiftKey || e.isComposing) return;
    const key = e.key.toLowerCase();
    const marker = key === "b" ? "**" : key === "i" ? "*" : key === "=" || key === "+" ? "==" : "";
    if (marker) wrap(ta, marker);
    else if (key === "k") linkify(ta);
    else return;
    e.preventDefault();
    fit();
  });
  ta.addEventListener("blur", () => {
    const s = session;
    window.setTimeout(() => open && session === s && document.activeElement !== ta && commit(), 150);
  });
  // Its own presses (the caret, a selection) aren't the canvas's.
  ta.addEventListener("pointerdown", (e) => e.stopPropagation());

  // A press anywhere else on the pad ends the editing, before the canvas
  // or a chip has it.
  const pressed = (e: PointerEvent) => {
    if (open && !ta.contains(e.target as Node)) commit();
  };
  env.host.addEventListener("pointerdown", pressed, true);
  // Put away, the app may not come back: the words are kept, and written.
  const hidden = () => {
    if (document.visibilityState !== "hidden" || !open) return;
    commit();
    flushNotepad();
  };
  document.addEventListener("visibilitychange", hidden);
  // WebKit scrolls a box to follow the caret even when its overflow is
  // hidden, which left Hush's canvas shifted in its pane with no way
  // back: a scroll of the canvas, or of a box round it within the pad,
  // is put back at once.
  const padEl = env.host.closest(".notepad") ?? env.host;
  const unscroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.contains(env.host) || !padEl.contains(t)) return;
    t.scrollTop = 0;
    t.scrollLeft = 0;
  };
  padEl.addEventListener("scroll", unscroll, true);

  // The last tap — on the bare canvas ("") or on a note (its id) — and
  // what it does if no second follows.
  let last: { on: string; x: number; y: number; t: number; timer: number; then?: () => void } | null = null;

  /** Is a tap on `on` at (cx, cy) the second of a double-tap? If not, it
   *  is kept as a first, and `then` is done once the window is out. */
  function second(on: string, cx: number, cy: number, then?: () => void): boolean {
    const was = last;
    const now = performance.now();
    last = null;
    if (was) window.clearTimeout(was.timer);
    if (was && was.on === on && now - was.t < DOUBLE_MS && Math.hypot(cx - was.x, cy - was.y) < DOUBLE_PX) return true;
    // A first tap elsewhere, still waiting: what it does, now.
    was?.then?.();
    const kept = { on, x: cx, y: cy, t: now, timer: 0, then };
    if (then) {
      kept.timer = window.setTimeout(() => {
        if (last === kept) last = null;
        then();
      }, DOUBLE_MS);
    }
    last = kept;
    return false;
  }

  return {
    edit,
    commit,
    /** The note being typed into, if it is on the pad. */
    editing: () => open?.link?.id ?? null,
    /** A tap on the bare canvas: the second of two opens a note there. */
    bareTap(cx: number, cy: number): void {
      if (second("", cx, cy)) create(cx, cy);
    },
    /** A tap on note `l`, `on` what was pressed in it. */
    tap(l: NoteLink, on: Element | null, cx: number, cy: number): void {
      const box = on?.closest<HTMLElement>("[data-task]");
      const ticked = box ? toggleTask(l.text ?? "", Number(box.dataset.task)) : null;
      if (ticked !== null) return env.retext(l, ticked);
      const href = on?.closest<HTMLElement>("[data-href]")?.dataset.href;
      if (href) return env.openLink(href);
      if (second(l.id, cx, cy, () => env.goTo(l))) edit(l);
    },
    destroy(): void {
      commit();
      if (last) window.clearTimeout(last.timer);
      env.host.removeEventListener("pointerdown", pressed, true);
      padEl.removeEventListener("scroll", unscroll, true);
      document.removeEventListener("visibilitychange", hidden);
    },
  };
}

export type TextNotes = ReturnType<typeof createTextNotes>;
