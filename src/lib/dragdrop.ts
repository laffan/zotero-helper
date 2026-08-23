// Dragging items out of the list (or icon grid) and onto a sidebar
// folder. Pointer events rather than HTML5 drag-and-drop: the latter is
// unreliable inside a WKWebView, and this app is used on an iPad more
// than anywhere else. A mouse starts dragging after a few pixels of
// movement; a finger has to hold still for a moment first, so ordinary
// scrolling still scrolls.
import { create } from "zustand";
import { addItemsToCollection } from "./actions";
import { itemTitle } from "./collections";
import { useStore } from "./store";

/** How far the mouse travels before a press becomes a drag. */
const MOUSE_SLOP = 5;
/** How long a finger must rest before a press becomes a drag. */
const TOUCH_HOLD_MS = 420;
/** How far a finger may stray during that hold before we call it a scroll. */
const TOUCH_SLOP = 10;

export interface DropTarget {
  key: string;
  name: string;
}

interface DragState {
  /** Item keys under the cursor. Empty means nothing is being dragged. */
  keys: string[];
  label: string;
  x: number;
  y: number;
  over: DropTarget | null;
}

const IDLE: DragState = { keys: [], label: "", x: 0, y: 0, over: null };

/** Kept out of the main app store: a drag updates on every pointer move
 *  and nothing else should re-render at that rate. */
export const useDrag = create<DragState>(() => IDLE);

/** True while `key` is the folder the pointer is over. Selector-based so
 *  a sidebar row re-renders only when its own highlight flips. */
export function useIsDropTarget(key: string): boolean {
  return useDrag((s) => s.over?.key === key);
}

/** True while a drag is in progress (the sidebar dims non-targets). */
export function useDragging(): boolean {
  return useDrag((s) => s.keys.length > 0);
}

/** The folder row under the given viewport point, if any. */
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const row = el?.closest?.("[data-drop-collection]") as HTMLElement | null;
  const key = row?.dataset.dropCollection;
  if (!key) return null;
  return { key, name: row?.dataset.dropName || "folder" };
}

/** The ghost names the row under the finger; the count beside it says
 *  how many are coming along. */
function labelFor(itemKey: string): string {
  const item = useStore.getState().library.items.find((i) => i.key === itemKey);
  const title = item ? itemTitle(item) : itemKey;
  return title.length > 44 ? `${title.slice(0, 41)}…` : title;
}

/**
 * Begin a possible drag from an item row. Call from `onPointerDown`;
 * it decides for itself whether the gesture turns into a drag, so rows
 * keep their normal click, double-click and scroll behavior.
 *
 * Dragging a row that is part of the current selection drags the whole
 * selection; dragging any other row drags (and selects) just that one.
 */
export function startItemDrag(e: React.PointerEvent, itemKey: string): void {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  // Row-level controls (the pin) own their own gestures.
  if ((e.target as HTMLElement | null)?.closest("button, a, input")) return;

  const selected = useStore.getState().selectedKeys;
  const keys = selected.includes(itemKey) ? [...selected] : [itemKey];
  const startX = e.clientX;
  const startY = e.clientY;
  const isTouch = e.pointerType !== "mouse";
  let active = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  // Once a touch drag is live, the page must stop scrolling under it.
  // Only a non-passive touchmove listener can say so in WebKit.
  const blockScroll = (ev: TouchEvent) => {
    if (active) ev.preventDefault();
  };

  const activate = (x: number, y: number) => {
    active = true;
    if (!selected.includes(itemKey)) {
      useStore.getState().setSelectedKeys([itemKey]);
    }
    window.addEventListener("touchmove", blockScroll, { passive: false });
    useDrag.setState({
      keys,
      label: labelFor(itemKey),
      x,
      y,
      over: targetAt(x, y),
    });
  };

  const stop = () => {
    clearTimeout(holdTimer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", blockScroll);
    // A press that never became a drag leaves the store untouched.
    if (useDrag.getState().keys.length > 0) useDrag.setState(IDLE);
  };

  const onMove = (ev: PointerEvent) => {
    const far = Math.hypot(ev.clientX - startX, ev.clientY - startY);
    if (!active) {
      // Before activation, movement means one of two things: a mouse
      // starting to drag, or a finger starting to scroll.
      if (isTouch) {
        if (far > TOUCH_SLOP) stop();
        return;
      }
      if (far < MOUSE_SLOP) return;
      activate(ev.clientX, ev.clientY);
    }
    useDrag.setState({
      x: ev.clientX,
      y: ev.clientY,
      over: targetAt(ev.clientX, ev.clientY),
    });
  };

  const onUp = () => {
    const dropped = active ? useDrag.getState().over : null;
    if (active) swallowNextClick();
    stop();
    if (dropped) void addItemsToCollection(keys, dropped.key, dropped.name);
  };

  const onCancel = () => stop();

  if (isTouch) holdTimer = setTimeout(() => activate(startX, startY), TOUCH_HOLD_MS);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}

/** A drag that ends over another row would otherwise land as a click on
 *  it. Eat exactly one, and only if it arrives immediately. */
function swallowNextClick(): void {
  const eat = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", eat, true);
  setTimeout(() => window.removeEventListener("click", eat, true), 0);
}
