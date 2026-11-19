// Post-its on the pages (lib/postits.ts keeps them as Zotero annotations
// and says why). Post-it — the bottom bar's button between the sentence
// tool and Add Section, reading mode's below the pen, or T — readies the
// tool: a dashed square follows a mouse or a hovering Pencil over the
// page under it, and the next tap on a page sticks a post-it there,
// centred on the tap, kept inside the page, in the colour picked last.
// The tool is then done, as Add Section is after one line: one post-it
// per press (a second press, or Escape, puts it away unused). While
// ready it has every press on the pages to itself, heard on the window
// before anything in them; a finger's drag still scrolls. A post-it can
// also be dragged out of either button onto a page (postitDragOut.ts).
//
// On the page a post-it is a square of paper over the text — an overlay
// on its page placed in percentages of the page, like the sections'
// lines, so it follows every zoom with no raster; its type and its
// strokes scale with it (`--pk`, CSS px per point, set as its box
// changes). Its grip, the darker band across its top, drags it about its
// page (any pointer; a finger there doesn't scroll), and a tap on the
// grip opens its menu (postitEdit.ts). On the paper the Pencil writes —
// and the mouse, dragged — or erases (postitInk.ts); a finger scrolls
// the pages as anywhere else, and two taps of it (or a double-click)
// type on it. A post-it someone else made in a group library is shown,
// not changed.
//
// Its presses are its own: heard on the scroll area as they arrive
// (registered before ink mode's, the sentence tool's and the rest, and
// stopped there), so the pen on a post-it never draws on the page under
// it nor a tap there selects a sentence; a finger's press goes on to
// scroll natively, its touch never cancelled. The Pencil's touches on a
// post-it are cancelled, so it doesn't scroll or select.
//
// What is changed shows at once and is written to Zotero a moment later:
// writing, once the pen has rested (WRITE_REST_MS, past the pause
// between words); a move, a colour, the words typed, at once. Until
// then — and while it is being written on, typed on or dragged — a
// post-it is the layer's own, and the copy that comes back through the
// store (`set`) doesn't overwrite it.
import { whenPenRested } from "../lib/penActivity";
import {
  isCropped, lastPostItColor, POSTIT_GRIP, restRect, POSTIT_INK, POSTIT_PEN, POSTIT_SIZE, postItsOf, rememberPostItColor, type PostIt, type PostItSave,
} from "../lib/postits";
import type { Annotation } from "../lib/highlights";
import { inkSortIndex } from "./ink/geometry";
import { dragCorner, leastInsets, showCrop } from "./postitCrop";
import { createPostItEditor, createPostItMenu } from "./postitEdit";
import { createPostItPen, drawPostItInk, type PenTarget } from "./postitInk";
import { dragPostIt } from "./postitMove";
import { beginPostItDrag } from "./postitDragOut";
import type { PageRecord } from "./types";
import type { PdfViewerOptions } from "./viewerOptions";

/** How the viewer's host keeps post-its (lib/postits.ts); it knows
 *  which PDF they are on. */
export interface PostItWriter {
  save: (p: Omit<PostItSave, "attKey">) => { textKey: string | null; inkKeys: string[] };
  remove: (p: { textKey: string | null; inkKeys: string[] }) => void;
  canEdit: (p: PostIt) => boolean;
  /** The pen is writing: the host holds back the push. */
  writing?: () => void;
}

interface PostItsEnv {
  root: HTMLElement;
  scrollArea: HTMLElement;
  /** The bottom bar's Post-it. */
  button: HTMLElement;
  /** `postIts`, the writer (absent: shown, not changed, and no tool),
   *  and `onPostItTool`. */
  opts: PdfViewerOptions;
  getPages: () => PageRecord[];
  getPageLabels: () => string[] | null;
  /** The tool is readied: the folded view is left for whole pages. */
  onStart: () => void;
}

/** A post-it as the layer holds it. */
interface Item extends PostIt {
  editable: boolean;
  /** Changed here and not yet written. */
  dirty: boolean;
  el?: HTMLElement;
  sig?: string;
}

/** Writing is written once the pen has rested this long, ms. */
const WRITE_REST_MS = 2000;
/** A press that moves this far is a drag or a scroll, not a tap. */
const TAP_PX = 8;
/** Two taps this close in time (ms) and place (px) are a double-tap. */
const DOUBLE_MS = 400;
const DOUBLE_PX = 24;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sizeOf = (it: { rect: number[] }) => [it.rect[2] - it.rect[0], it.rect[3] - it.rect[1]];
/** What a post-it shows, to tell whether it must be drawn again. */
const sigOf = (it: Item) =>
  JSON.stringify([it.pageIndex, it.rect, it.color, it.crop, it.shift, it.text, it.strokes, it.editable]);

export function createPostIts(env: PostItsEnv) {
  const { scrollArea } = env;
  const writer = env.opts.postIts;
  const items = new Map<string, Item>();
  const pen = createPostItPen({ writing: writer?.writing });
  const menu = createPostItMenu(env.root, scrollArea);
  const editor = createPostItEditor();
  let dragging: string | null = null;
  // Each post-it's type and strokes scale with its box.
  const sizer = new ResizeObserver((entries) => {
    for (const en of entries) {
      const el = en.target as HTMLElement;
      const it = items.get(el.dataset.postitId ?? "");
      if (it) el.style.setProperty("--pk", `${el.clientWidth / sizeOf(it)[0]}px`);
    }
  });

  // --- on the page ----------------------------------------------------------
  /** A post-it's box on its page, as fractions of the page. */
  function frac(it: Item, p: PageRecord) {
    const [ax, ay] = p.viewport.convertToViewportPoint(it.rect[0], it.rect[3]);
    const [bx, by] = p.viewport.convertToViewportPoint(it.rect[2], it.rect[1]);
    const W = p.viewport.width;
    const H = p.viewport.height;
    return { l: Math.min(ax, bx) / W, t: Math.min(ay, by) / H, w: Math.abs(bx - ax) / W, h: Math.abs(by - ay) / H };
  }

  function layerOf(p: PageRecord): HTMLElement {
    let layer = p.wrapper.querySelector<HTMLElement>(":scope > .pdf-postits");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "pdf-postits";
      // The Pencil's touches on a post-it are cancelled — it writes, it
      // doesn't scroll or select; a finger's are left alone.
      layer.addEventListener("touchstart", onTouch, { passive: false });
      layer.addEventListener("touchmove", onTouch, { passive: false });
      p.wrapper.appendChild(layer);
    }
    return layer;
  }

  function build(it: Item): HTMLElement {
    const el = document.createElement("div");
    el.className = "pdf-postit";
    el.dataset.postitId = it.id;
    // What is on the paper is on its sheet, which a crop clips; the
    // corners that set the crop are outside it.
    el.innerHTML =
      `<div class="pdf-postit-sheet">` +
      `<div class="pdf-postit-grip" title="Drag to move · tap for colours, Type and Delete"></div>` +
      `<div class="pdf-postit-text"></div>` +
      `<svg class="pdf-postit-ink" preserveAspectRatio="none" fill="none" stroke="${POSTIT_INK}" stroke-width="${POSTIT_PEN}" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>` +
      `<div class="pdf-postit-hint">Write here, or double-tap to type</div></div>` +
      ["t l", "t r", "b l", "b r"].map((c) => `<div class="pdf-postit-corner ${c}" title="Drag to pare the post-it down"></div>`).join("");
    sizer.observe(el);
    return el;
  }

  /** Draw a post-it (again) on its page. */
  function draw(it: Item): void {
    const p = env.getPages()[it.pageIndex];
    if (!p) return;
    const el = it.el ?? (it.el = build(it));
    const layer = layerOf(p);
    if (el.parentElement !== layer) layer.appendChild(el);
    place(it, p);
    const sig = sigOf(it);
    if (sig === it.sig) return;
    it.sig = sig;
    el.style.setProperty("--postit-color", it.color);
    showCrop(el, it.crop, it.shift);
    el.classList.toggle("cropped", isCropped(it.crop));
    el.classList.toggle("readonly", !it.editable);
    el.classList.toggle("empty", !it.text.trim() && !it.strokes.length);
    el.querySelector(".pdf-postit-text")!.textContent = it.text;
    const [w, h] = sizeOf(it);
    drawPostItInk(el.querySelector<SVGSVGElement>(".pdf-postit-ink")!, it.strokes, w, h);
  }

  function place(it: Item, p: PageRecord): void {
    const f = frac(it, p);
    Object.assign(it.el!.style, {
      left: `${f.l * 100}%`,
      top: `${f.t * 100}%`,
      width: `${f.w * 100}%`,
      height: `${f.h * 100}%`,
    });
  }

  function drop(it: Item): void {
    if (it.el) sizer.unobserve(it.el);
    it.el?.remove();
    items.delete(it.id);
  }

  // --- kept -------------------------------------------------------------------
  const waiting = new Set<string>();
  let cancelWait: (() => void) | null = null;

  /** Write a post-it as it is now. */
  function commit(id: string): void {
    waiting.delete(id);
    const it = items.get(id);
    if (!it || !writer || !it.editable) return;
    const keys = writer.save({
      id: it.id, pageIndex: it.pageIndex, pageLabel: it.pageLabel, sortIndex: it.sortIndex,
      rect: it.rect, color: it.color, crop: it.crop, shift: it.shift, text: it.text, strokes: it.strokes, textKey: it.textKey, inkKeys: it.inkKeys,
    });
    it.textKey = keys.textKey;
    it.inkKeys = keys.inkKeys;
    it.dirty = false;
  }
  function flush(): void {
    cancelWait?.();
    cancelWait = null;
    for (const id of [...waiting]) commit(id);
  }
  /** `it` changed: written now, or once the pen has rested. */
  function changed(it: Item, now = true): void {
    it.dirty = true;
    waiting.add(it.id);
    if (now) return flush();
    cancelWait?.();
    cancelWait = whenPenRested(WRITE_REST_MS, flush);
  }

  /** Busy: being written on, typed on, dragged or pared down — the
   *  layer's own. */
  const busy = (id: string) =>
    pen.busy(id) || editor.editing(id) || dragging === id || Boolean(items.get(id)?.el?.classList.contains("cropping"));

  // --- the tool ---------------------------------------------------------------
  let placing = false;
  let guide: HTMLElement | null = null;
  let press: { id: number; x: number; y: number; idx: number; wrapper: HTMLElement } | null = null;
  let eatClickUntil = 0;

  function pageAt(target: EventTarget | null): { wrapper: HTMLElement; idx: number } | null {
    const el = target instanceof Element ? target : null;
    if (!el || el.closest("button, a, input, textarea")) return null;
    const wrapper = el.closest<HTMLElement>(".pdf-page-wrapper");
    const idx = Number(wrapper?.dataset.pageIndex ?? NaN);
    return wrapper && Number.isInteger(idx) ? { wrapper, idx } : null;
  }

  /** The PDF rect of a new post-it centred on a client point. */
  function rectAt(idx: number, wrapper: HTMLElement, x: number, y: number): number[] | null {
    const p = env.getPages()[idx];
    if (!p) return null;
    const r = wrapper.getBoundingClientRect();
    const [cx, cy] = p.viewport.convertToPdfPoint(((x - r.left) / r.width) * p.viewport.width, ((y - r.top) / r.height) * p.viewport.height);
    const [x0, y0, x1, y1] = p.viewport.viewBox;
    const s = Math.min(POSTIT_SIZE, x1 - x0, y1 - y0);
    const left = clamp(cx - s / 2, x0, x1 - s);
    const bottom = clamp(cy - s / 2, y0, y1 - s);
    return [left, bottom, left + s, bottom + s];
  }

  function showGuide(idx: number, wrapper: HTMLElement, x: number, y: number): void {
    const rect = rectAt(idx, wrapper, x, y);
    const p = env.getPages()[idx];
    if (!rect || !p) return;
    if (!guide) {
      guide = document.createElement("div");
      guide.className = "pdf-postit-guide";
      guide.style.setProperty("--postit-color", lastPostItColor());
    }
    const f = frac({ rect } as Item, p);
    if (guide.parentElement !== wrapper) wrapper.appendChild(guide);
    Object.assign(guide.style, { left: `${f.l * 100}%`, top: `${f.t * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` });
  }
  function hideGuide(): void {
    guide?.remove();
  }

  function setPlacing(on: boolean): void {
    if (on === placing) return;
    placing = on;
    env.button.classList.toggle("active", on);
    scrollArea.classList.toggle("pdf-postit-placing", on);
    env.opts.onPostItTool?.(on);
    const listen = (on ? window.addEventListener : window.removeEventListener).bind(window);
    listen("pointerdown", onPlaceDown, true);
    listen("pointerup", onPlaceUp, true);
    listen("pointercancel", onPlaceCancel, true);
    listen("keydown", onPlaceKey, true);
    if (on) {
      env.onStart();
      scrollArea.addEventListener("pointermove", onHover);
      scrollArea.addEventListener("pointerleave", hideGuide);
    } else {
      press = null;
      hideGuide();
      scrollArea.removeEventListener("pointermove", onHover);
      scrollArea.removeEventListener("pointerleave", hideGuide);
    }
  }

  function onHover(e: PointerEvent): void {
    if (press || e.pointerType === "touch") return;
    const at = pageAt(e.target);
    if (at) showGuide(at.idx, at.wrapper, e.clientX, e.clientY);
    else hideGuide();
  }
  function onPlaceDown(e: PointerEvent): void {
    if ((e.pointerType === "mouse" && e.button !== 0) || !scrollArea.contains(e.target as Node)) return;
    const at = pageAt(e.target);
    if (!at) return;
    // The tool's, before anything in the pages hears it.
    e.preventDefault();
    e.stopPropagation();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, ...at };
    showGuide(at.idx, at.wrapper, e.clientX, e.clientY);
  }
  function onPlaceUp(e: PointerEvent): void {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    eatClickUntil = performance.now() + 700;
    hideGuide();
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_PX) return;
    stick(p.idx, p.wrapper, p.x, p.y);
    setPlacing(false);
  }
  function onPlaceCancel(e: PointerEvent): void {
    if (press && e.pointerId === press.id) {
      press = null;
      hideGuide();
    }
  }
  function onPlaceKey(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    // Before reading mode's own Escape, which would leave it.
    e.preventDefault();
    e.stopPropagation();
    setPlacing(false);
  }

  /** A new post-it on page `idx`, centred on a client point. */
  function stick(idx: number, wrapper: HTMLElement, x: number, y: number): void {
    const rect = rectAt(idx, wrapper, x, y);
    const p = env.getPages()[idx];
    if (!rect || !p || !writer) return;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const it: Item = {
      id, attKey: "", pageIndex: idx, rect, color: lastPostItColor(), crop: [0, 0, 0, 0], shift: [0, 0], text: "", strokes: [],
      pageLabel: env.getPageLabels()?.[idx] || String(idx + 1), sortIndex: sortIndexOf(p, idx, rect),
      textKey: null, inkKeys: [], parts: [], editable: true, dirty: true,
    };
    items.set(id, it);
    draw(it);
    changed(it);
  }

  function sortIndexOf(p: PageRecord, idx: number, rect: number[]): string {
    return inkSortIndex(idx, 0, p.viewport.viewBox[3] - rect[3]);
  }

  // --- presses on a post-it ---------------------------------------------------
  let lastTap: { id: string; t: number; x: number; y: number } | null = null;

  function onDown(e: PointerEvent): void {
    const el = (e.target as Element).closest?.<HTMLElement>(".pdf-postit");
    const it = el ? items.get(el.dataset.postitId ?? "") : undefined;
    // Another tool's press: Add Section's, or the reading crop's.
    if (!el || !it || placing || scrollArea.matches(".pdf-divider-placing, .pdf-crop-editing")) return;
    // Its own: nothing on the page under it hears the press.
    e.stopImmediatePropagation();
    if ((e.target as Element).closest(".pdf-postit-editor")) return;
    if (!it.editable || (e.pointerType === "mouse" && e.button !== 0)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && scrollArea.contains(sel.anchorNode)) sel.removeAllRanges();
    const corner = (e.target as Element).closest<HTMLElement>(".pdf-postit-corner");
    const p = env.getPages()[it.pageIndex];
    if (corner && p) {
      const [w, h] = sizeOf(it);
      const which = { top: corner.classList.contains("t"), left: corner.classList.contains("l") };
      // What shows stays on the page, the paper at its rest place.
      const least = leastInsets(restRect(it.rect, it.shift), p.viewport.viewBox);
      return dragCorner({ el, w, h, crop: it.crop }, e, which, least, it.shift, (crop) => {
        const cur = items.get(it.id);
        if (!cur) return;
        cur.crop = crop;
        cur.sig = sigOf(cur);
        el.classList.toggle("cropped", isCropped(crop));
        changed(cur);
      });
    }
    // The grip: its band, or for a finger a little below it too (CSS's
    // --grip-reach), where the Pencil and the mouse still write.
    const band = el.getBoundingClientRect().top + (el.clientWidth / sizeOf(it)[0]) * POSTIT_GRIP;
    if ((e.target as Element).closest(".pdf-postit-grip") && (e.pointerType === "touch" || e.clientY <= band + 1)) return grab(it, e);
    // Pared down at rest, a press on it opens it: whole, in its page
    // (a finger's tap; the Pencil's or the mouse's press), writing nothing.
    const closed = isCropped(it.crop) && openId !== it.id;
    if (e.pointerType === "touch") return watchTap(it, e, closed);
    e.preventDefault();
    if (closed) {
      openIt(it);
      if (e.pointerType === "mouse") lastTap = { id: it.id, t: performance.now(), x: e.clientX, y: e.clientY };
      return;
    }
    // A double-click types; a click, or a drag, writes.
    const now = performance.now();
    if (e.pointerType === "mouse" && lastTap?.id === it.id && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_PX) {
      lastTap = null;
      return type(it);
    }
    if (e.pointerType === "mouse") lastTap = { id: it.id, t: now, x: e.clientX, y: e.clientY };
    pen.down(penTarget(it), e);
  }

  function penTarget(it: Item): PenTarget {
    const [w, h] = sizeOf(it);
    return {
      id: it.id,
      el: it.el!,
      w,
      h,
      get strokes() {
        return it.strokes;
      },
      set strokes(s: number[][]) {
        it.strokes = s;
      },
      changed: () => {
        it.sig = sigOf(it);
        it.el?.classList.toggle("empty", !it.text.trim() && !it.strokes.length);
        changed(it, false);
      },
    };
  }

  /** A finger on the paper: a tap, and a second within DOUBLE_MS, types;
   *  a tap on one pared down at rest (`closed`) opens it. */
  function watchTap(it: Item, e: PointerEvent, closed: boolean): void {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const t0 = performance.now();
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (ev.type !== "pointerup" || Math.hypot(ev.clientX - x0, ev.clientY - y0) > TAP_PX || performance.now() - t0 > 350) return;
      const now = performance.now();
      if (lastTap?.id === it.id && now - lastTap.t < DOUBLE_MS && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < DOUBLE_PX) {
        lastTap = null;
        ev.preventDefault();
        type(it);
      } else {
        lastTap = { id: it.id, t: now, x: ev.clientX, y: ev.clientY };
        if (closed) openIt(it);
      }
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  /** The grip: a drag moves the post-it about its page (postitMove.ts),
   *  a tap opens its menu. */
  function grab(it: Item, e: PointerEvent): void {
    pen.settle();
    const el = it.el!;
    const p = env.getPages()[it.pageIndex];
    if (!p) return;
    dragging = it.id;
    const whole = !isCropped(it.crop) || openId === it.id;
    dragPostIt({ el, rect: it.rect, shift: it.shift, crop: it.crop, whole }, e, p.viewport.viewBox, (to, ev) => {
      dragging = null;
      eatClickUntil = performance.now() + 700;
      const cur = items.get(it.id);
      if (!cur) return;
      if (to) {
        cur.rect = to.rect;
        cur.shift = to.shift;
        cur.sortIndex = sortIndexOf(p, cur.pageIndex, cur.rect);
        draw(cur);
        return changed(cur);
      }
      if (ev.type === "pointerup") openMenu(cur, el);
    });
  }

  function openMenu(it: Item, el: HTMLElement): void {
    if (menu.isOpen()) return menu.close();
    // The post-it as it is when a choice is made: the copy the store
    // sends back may have taken this one's place meanwhile.
    const now = () => items.get(it.id);
    menu.open({
      anchor: el,
      color: it.color,
      setColor: (c) => {
        const cur = now();
        rememberPostItColor(c);
        if (!cur) return;
        cur.color = c;
        draw(cur);
        changed(cur);
      },
      type: () => {
        const cur = now();
        if (cur) type(cur);
      },
      uncrop: isCropped(it.crop)
        ? () => {
            const cur = now();
            if (!cur) return;
            if (openId === cur.id) closeIt();
            cur.crop = [0, 0, 0, 0];
            cur.shift = [0, 0];
            draw(cur);
            changed(cur);
          }
        : undefined,
      remove: () => {
        editor.commit();
        const cur = now();
        if (!cur) return;
        if (openId === cur.id) closeIt();
        drop(cur);
        waiting.delete(cur.id);
        writer?.remove(cur);
      },
    });
  }

  // --- open and closed ---------------------------------------------------------
  // A post-it pared down at rest opens — whole, slid into its page — at a
  // press on it, or to be typed on; a press anywhere else, or Escape,
  // closes it again, back to its rest place and its crop.
  let openId: string | null = null;

  function openIt(it: Item): void {
    if (!isCropped(it.crop) || openId === it.id) return;
    closeIt();
    openId = it.id;
    it.el?.classList.add("open");
  }
  function closeIt(): void {
    const id = openId;
    if (!id) return;
    openId = null;
    editor.commit();
    items.get(id)?.el?.classList.remove("open");
  }
  function onAnyDown(e: PointerEvent): void {
    if (!openId) return;
    const t = e.target as Element;
    if (t.closest?.(`.pdf-postit-menu, .pdf-postit[data-postit-id="${CSS.escape(openId)}"]`)) return;
    closeIt();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !openId || e.defaultPrevented || editor.isOpen() || menu.isOpen()) return;
    // Before reading mode's own Escape, which would leave it.
    e.preventDefault();
    e.stopPropagation();
    closeIt();
  }

  /** Type on a post-it (opened first, when it is pared down). */
  function type(it: Item): void {
    pen.settle();
    if (!it.el) return;
    openIt(it);
    editor.begin({
      id: it.id,
      el: it.el,
      text: it.text,
      done: (text) => {
        const cur = items.get(it.id);
        if (!cur || text === cur.text) return;
        cur.text = text;
        draw(cur);
        changed(cur);
      },
    });
  }

  function onTouch(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if ((t as Touch & { touchType?: string }).touchType === "stylus") {
        e.preventDefault();
        return;
      }
    }
  }

  // The click that ends a press the post-its took (the tool's tap, a
  // grip's drag or tap, a press on the paper) isn't the pages'.
  function onClick(e: MouseEvent): void {
    const on = (e.target as Element).closest?.(".pdf-postit");
    if (!on && performance.now() > eatClickUntil) return;
    if (!scrollArea.contains(e.target as Node)) return;
    if (!on) eatClickUntil = 0;
    e.stopImmediatePropagation();
    if (!(e.target as Element).closest?.(".pdf-postit-editor")) e.preventDefault();
  }

  const onHidden = () => document.visibilityState === "hidden" && (pen.settle(), flush());

  const enabled = Boolean(writer);
  if (enabled) env.button.addEventListener("click", () => setPlacing(!placing));
  else env.button.style.display = "none";
  // Dragged out of a button (this one, or reading mode's) onto a page.
  const dragOut = (e: PointerEvent, button: HTMLElement) =>
    beginPostItDrag(e, button, {
      enabled: () => enabled,
      color: lastPostItColor,
      start: env.onStart,
      guideAt(x, y) {
        const at = pageAt(document.elementFromPoint(x, y));
        if (at) showGuide(at.idx, at.wrapper, x, y);
        else hideGuide();
        return at !== null;
      },
      hideGuide,
      stickAt(x, y) {
        const at = pageAt(document.elementFromPoint(x, y));
        if (!at) return false;
        stick(at.idx, at.wrapper, x, y);
        setPlacing(false);
        return true;
      },
    });
  env.button.addEventListener("pointerdown", (e) => dragOut(e, env.button));
  scrollArea.addEventListener("pointerdown", onDown, true);
  scrollArea.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pointerdown", onAnyDown, true);
  window.addEventListener("keydown", onKey, true);

  return {
    /** The PDF's post-its, from its annotations. One being worked on, or
     *  changed and not yet written, stays as it is here. */
    setAnnotations(annotations: Annotation[]): void {
      const list = postItsOf(annotations);
      const next = new Set(list.map((p) => p.id));
      for (const it of [...items.values()]) {
        if (!next.has(it.id) && !it.dirty && !busy(it.id)) drop(it);
      }
      for (const p of list) {
        const cur = items.get(p.id);
        if (cur && (cur.dirty || busy(p.id))) continue;
        const it: Item = { ...p, editable: writer ? writer.canEdit(p) : false, dirty: false, el: cur?.el, sig: cur?.sig };
        items.set(p.id, it);
        draw(it);
      }
    },
    /** A page was drawn, perhaps at a size of its own: its post-its are
     *  placed again. */
    pageRendered(idx: number): void {
      const p = env.getPages()[idx];
      if (p) for (const it of items.values()) if (it.pageIndex === idx && it.el) place(it, p);
    },
    /** A press on a Post-it button outside the viewer (reading mode's):
     *  dragged, it sticks a post-it where it is let go. */
    dragOut,
    /** Write what waits (the PDF closing). */
    flush(): void {
      editor.commit();
      pen.settle();
      flush();
    },
    destroy(): void {
      editor.destroy();
      pen.destroy();
      flush();
      setPlacing(false);
      menu.close();
      sizer.disconnect();
      scrollArea.removeEventListener("pointerdown", onDown, true);
      scrollArea.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pointerdown", onAnyDown, true);
      window.removeEventListener("keydown", onKey, true);
    },
  };
}
