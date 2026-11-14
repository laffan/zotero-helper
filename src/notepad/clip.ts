// Clip mode (the notepad's scissors, NotepadBody.tsx): every press on
// the pages — a finger, the Pencil or the mouse — draws a box on a page,
// dashed red, with Clip under it. A press inside the box moves it, a
// press on one of its corners sizes it, and a press anywhere else on a
// page starts another. Clip cuts what the box holds out of the page as
// an image (pdfviewer/excerpt.ts) and puts it on the pad, and clip mode
// ends; so does Escape, the × beside Clip, or the scissors again.
//
// The pages' own handlers (selecting, the pen, the sentence tool,
// highlights) are many, on the scroll area and the window, so rather
// than outrun each one, clip mode lays a transparent overlay over the
// scroll area, inside the viewer (as the thumbnail grid is), and every
// press lands on it. A wheel or a trackpad still scrolls the pages
// beneath; the box is kept as fractions of its page and follows it.
import { pageBoxAt } from "../pdfviewer/annotate";
import { capture, onPress } from "./links";

/** Left, top, right, bottom: fractions of the page. */
export type ClipBox = [number, number, number, number];

export interface ClipModeEnv {
  /** Cut page `pageIndex`'s region `box` out, onto the pad. */
  clip: (pageIndex: number, box: ClipBox) => Promise<void>;
  /** Clip mode is over (a clip made, Escape, ×, or `stop`). */
  ended: () => void;
}

/** A box smaller than this either way (CSS px) is dropped. */
const MIN_PX = 12;

export const SCISSORS_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="4.2" r="2.1"/><circle cx="4" cy="11.8" r="2.1"/><path d="M5.8 5.3L14 12.5M5.8 10.7L14 3.5"/></svg>`;

type Corner = "nw" | "ne" | "sw" | "se";

export function startClipMode(env: ClipModeEnv): { stop: () => void } | null {
  const area = document.querySelector<HTMLElement>(".pdf-scroll-area");
  const body = area?.parentElement;
  if (!area || !body) return null;

  const overlay = document.createElement("div");
  overlay.className = "pdf-clip-overlay";
  const hint = document.createElement("div");
  hint.className = "pdf-clip-hint";
  hint.textContent = "Drag over a page to clip part of it";
  const frame = document.createElement("div");
  frame.className = "pdf-clip-box";
  for (const c of ["nw", "ne", "sw", "se"] as Corner[]) {
    const h = document.createElement("span");
    h.className = `pdf-clip-handle pdf-clip-${c}`;
    h.dataset.corner = c;
    frame.appendChild(h);
  }
  const bar = document.createElement("div");
  bar.className = "pdf-clip-bar";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "pdf-clip-go";
  go.innerHTML = `${SCISSORS_SVG}<span>Clip</span>`;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "pdf-clip-cancel";
  cancel.setAttribute("aria-label", "Stop clipping");
  cancel.title = "Stop clipping (Esc)";
  cancel.textContent = "×";
  bar.append(go, cancel);
  overlay.append(hint, frame, bar);
  body.appendChild(overlay);

  // The box, on its page.
  let sel: { pageIndex: number; page: HTMLElement; f: ClipBox } | null = null;
  let drag: { id: number; kind: "new" | "move" | Corner; from: [number, number]; f0: ClipBox } | null = null;
  let busy = false;

  /** Draw the box (and Clip under it) where its page now is. */
  function place(): void {
    const shown = Boolean(sel && sel.page.isConnected);
    frame.style.display = bar.style.display = shown ? "" : "none";
    hint.style.display = sel ? "none" : "";
    if (!sel || !shown) return;
    const o = overlay.getBoundingClientRect();
    const p = sel.page.getBoundingClientRect();
    const [l, t, r, b] = sel.f;
    const x = p.left + l * p.width - o.left;
    const y = p.top + t * p.height - o.top;
    const w = (r - l) * p.width;
    const h = (b - t) * p.height;
    Object.assign(frame.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    // Under the box, centred — inside its foot when the view ends there.
    const below = y + h + 8;
    const top = below + bar.offsetHeight > overlay.clientHeight - 6 ? y + h - bar.offsetHeight - 8 : below;
    bar.style.left = `${Math.max(6, Math.min(x + w / 2 - bar.offsetWidth / 2, overlay.clientWidth - bar.offsetWidth - 6))}px`;
    bar.style.top = `${Math.max(6, top)}px`;
  }

  /** A client point as fractions of `page`, kept on it. */
  function fracOn(page: HTMLElement, x: number, y: number): [number, number] {
    const p = page.getBoundingClientRect();
    const k = (v: number) => Math.max(0, Math.min(1, v));
    return [k((x - p.left) / p.width), k((y - p.top) / p.height)];
  }

  /** The page under a client point, looking through the overlay. */
  function pageAt(x: number, y: number) {
    const el = document.elementsFromPoint(x, y).find((e) => !overlay.contains(e));
    return el ? pageBoxAt(el) : null;
  }

  function onDown(e: PointerEvent): void {
    if (busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as Element).closest(".pdf-clip-bar")) return;
    e.preventDefault();
    const corner = (e.target as HTMLElement).dataset?.corner as Corner | undefined;
    const r = frame.getBoundingClientRect();
    const inside = sel && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (sel && (corner || inside)) {
      drag = { id: e.pointerId, kind: corner ?? "move", from: [e.clientX, e.clientY], f0: [...sel.f] };
    } else {
      const at = pageAt(e.clientX, e.clientY);
      if (!at) return;
      const [fx, fy] = fracOn(at.box, e.clientX, e.clientY);
      sel = { pageIndex: at.pageIndex, page: at.box, f: [fx, fy, fx, fy] };
      drag = { id: e.pointerId, kind: "new", from: [e.clientX, e.clientY], f0: [fx, fy, fx, fy] };
    }
    capture(overlay, e.pointerId);
    place();
  }

  function onMove(e: PointerEvent): void {
    if (!drag || !sel || e.pointerId !== drag.id) return;
    const [fx, fy] = fracOn(sel.page, e.clientX, e.clientY);
    const [l, t, r, b] = drag.f0;
    if (drag.kind === "new") sel.f = [Math.min(l, fx), Math.min(t, fy), Math.max(l, fx), Math.max(t, fy)];
    else if (drag.kind === "move") {
      const [ox, oy] = fracOn(sel.page, drag.from[0], drag.from[1]);
      const dx = Math.max(-l, Math.min(1 - r, fx - ox));
      const dy = Math.max(-t, Math.min(1 - b, fy - oy));
      sel.f = [l + dx, t + dy, r + dx, b + dy];
    } else {
      // The corner dragged follows the pointer; the opposite one stays.
      const [ax, ay] = [drag.kind.includes("w") ? r : l, drag.kind.includes("n") ? b : t];
      sel.f = [Math.min(ax, fx), Math.min(ay, fy), Math.max(ax, fx), Math.max(ay, fy)];
    }
    place();
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (!sel) return;
    const p = sel.page.getBoundingClientRect();
    if ((sel.f[2] - sel.f[0]) * p.width < MIN_PX || (sel.f[3] - sel.f[1]) * p.height < MIN_PX) sel = null;
    place();
  }

  // A wheel or a trackpad scrolls the pages beneath, the box with them.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    area.scrollBy(e.deltaX, e.deltaY);
  };
  // No scrolling, selecting or callout from a finger or the Pencil.
  const onTouch = (e: TouchEvent) => {
    if (!(e.target as Element).closest?.(".pdf-clip-bar")) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Before reading mode's own Escape, which would leave it.
    e.preventDefault();
    e.stopPropagation();
    stop();
  };
  const resized = new ResizeObserver(place);
  resized.observe(area);
  overlay.addEventListener("pointerdown", onDown);
  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onUp);
  overlay.addEventListener("pointercancel", onUp);
  overlay.addEventListener("wheel", onWheel, { passive: false });
  overlay.addEventListener("touchstart", onTouch, { passive: false });
  area.addEventListener("scroll", place, { passive: true });
  window.addEventListener("keydown", onKey, true);

  onPress(cancel, () => stop());
  onPress(go, () => {
    if (!sel || busy) return;
    busy = true;
    overlay.classList.add("busy");
    const { pageIndex, f } = sel;
    void env.clip(pageIndex, f).finally(stop);
  });

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    resized.disconnect();
    area?.removeEventListener("scroll", place);
    window.removeEventListener("keydown", onKey, true);
    overlay.remove();
    env.ended();
  }

  place();
  return { stop };
}
