// Ink mode: Zotero's pen, in the viewer. Drawings made here are ink
// annotations exactly as Zotero's reader makes them — `annotationType`
// "ink", a position of `{ pageIndex, width, paths }` in PDF points, a
// colour, a page label and a sortIndex — so Zotero desktop, iOS and the
// web library show them as theirs, and theirs show here.
//
// The parts: session.ts holds the drawings and this viewer's changes to
// them (and writes them once the pen rests), layer.ts draws them on the
// pages, live.ts draws the stroke still under the pen, input.ts reads
// the pen, bar.ts is its tools in the bottom bar. A Pencil double-tap
// (tauri-plugin-pencil, through lib/pencil.ts) switches between the
// pen and the eraser, whatever the system's Pencil setting; a Pencil
// Pro's squeeze does what that setting says.
import { ANNOTATION_COLORS, annotationPosition, type Annotation } from "../../lib/highlights";
import { pencilOnNotepad } from "../../lib/pencil";
import type { PageRecord } from "../types";
import { createInkBar, loadInkPrefs, saveInkPrefs } from "./bar";
import {
  INK_EXTRA_COLORS, inkSortIndex, inkStrokeColor, MAX_POSITION_CHARS, smoothPath, splitLongPath, type Rect,
} from "./geometry";
import { attachInkInput, type InkTool } from "./input";
import { createInkLayer, type InkAnn } from "./layer";
import { createLiveLayer } from "./live";
import { boundsOf, createInkSession } from "./session";

/** A new ink annotation, as the viewer hands it to its writer. */
export interface InkDraft {
  key: string;
  pageIndex: number;
  color: string;
  width: number;
  paths: number[][];
  sortIndex: string;
  pageLabel: string;
}

export interface InkWriter {
  newKey: () => string;
  createInk: (d: InkDraft) => void;
  /** `position` is the stored JSON. */
  update: (key: string, patch: { color?: string; position?: string; sortIndex?: string }) => void;
  remove: (key: string) => void;
  canEdit: (a: Annotation) => boolean;
  /** The pen is writing (down, or just lifted): the host holds back
   *  work that would land mid-stroke (the annotation push). */
  writing?: () => void;
}

export interface InkEnv {
  /** The viewer's body (the host of the overlays and the colour /
   *  width popup) and its pages' scroll area. */
  body: HTMLElement;
  scrollArea: HTMLElement;
  /** The bottom bar's pen button. */
  button: HTMLButtonElement;
  getPages: () => PageRecord[];
  getPageLabels: () => string[] | null;
  /** Absent: drawings are shown, not edited, and there is no ink mode. */
  writer?: InkWriter;
  /** Ink mode is starting: the viewer leaves views it can't draw in. */
  onStart: () => void;
  /** The pen (or eraser) came down. */
  onPenDown?: () => void;
  /** Ink mode went on or off. */
  onActiveChange?: (on: boolean) => void;
}

const SELECTION_PAD = 3;

/** The character on the page nearest a point (page fractions), counted
 *  in the text layer — what Zotero's sortIndex orders by within a page.
 *  pdf.js places each span in percentages of the page, so this reads
 *  the styles, not the layout. */
function textOffsetNear(p: PageRecord, fx: number, fy: number): number {
  const spans = p.contentEl?.querySelectorAll<HTMLElement>(".textLayer span:not(.markedContent)");
  if (!spans?.length) return 0;
  let count = 0;
  let best = 0;
  let bestD = Infinity;
  for (const s of Array.from(spans)) {
    const dx = parseFloat(s.style.left) / 100 - fx;
    const dy = parseFloat(s.style.top) / 100 - fy;
    // Being on the same line counts for more than being near in it.
    const d = dx * dx + 9 * dy * dy;
    if (d < bestD) {
      bestD = d;
      best = count;
    }
    count += (s.textContent ?? "").replace(/\s+/g, "").length;
  }
  return best;
}

/** Each annotation's ink, as the layer takes it — kept with the
 *  annotation object, which the library index reuses while the item is
 *  unchanged (lib/highlights.ts), so a store write doesn't re-read
 *  every drawing in the PDF. */
const inkOf = new WeakMap<Annotation, InkAnn | null>();

export function createInkTool(env: InkEnv) {
  const { writer } = env;
  const prefs = loadInkPrefs();
  let previousTool: InkTool = prefs.tool === "eraser" ? "pen" : prefs.tool;
  let active = false;
  let sel: { idx: number; keys: string[] } | null = null;

  const layer = createInkLayer(env.getPages);
  const live = createLiveLayer(env.body, env.scrollArea);

  function sortIndexFor(a: InkAnn): string {
    const p = env.getPages()[a.pageIndex];
    const b = boundsOf(a);
    if (!p || !b) return inkSortIndex(a.pageIndex, 0, 0);
    const vb = p.viewport.viewBox;
    const [vx, vy] = p.viewport.convertToViewportPoint(b[0], b[3]);
    const offset = textOffsetNear(p, vx / p.viewport.width, vy / p.viewport.height);
    return inkSortIndex(a.pageIndex, offset, vb[3] - vb[1] - b[3]);
  }

  const session = createInkSession(layer, {
    newKey: () => writer?.newKey() ?? "",
    create: (a) =>
      writer?.createInk({
        key: a.key,
        pageIndex: a.pageIndex,
        color: a.color,
        width: a.width,
        paths: a.paths,
        sortIndex: sortIndexFor(a),
        pageLabel: env.getPageLabels()?.[a.pageIndex] || String(a.pageIndex + 1),
      }),
    update: (a, before) => {
      const patch: { color?: string; position?: string; sortIndex?: string } = {};
      if (a.color !== before.color) patch.color = a.color;
      if (a.pos !== before.pos) {
        patch.position = a.pos;
        patch.sortIndex = sortIndexFor(a);
      }
      writer?.update(a.key, patch);
    },
    remove: (key) => writer?.remove(key),
  });

  // --- selection --------------------------------------------------------
  function selected(): InkAnn[] {
    return (sel?.keys ?? []).map((k) => session.get(k)).filter((a): a is InkAnn => Boolean(a));
  }
  function showSelection(dx = 0, dy = 0): void {
    const list = selected();
    if (!list.length) sel = null;
    layer.showSelection(sel?.idx ?? null, list.map((a) => boundsOf(a)).filter((b): b is Rect => Boolean(b)), SELECTION_PAD, dx, dy);
    syncBar();
  }
  function select(idx: number, keys: string[]): void {
    sel = keys.length ? { idx, keys } : null;
    showSelection();
  }
  function selectionHas(idx: number, x: number, y: number): boolean {
    if (!sel || sel.idx !== idx) return false;
    return selected().some((a) => {
      const b = boundsOf(a);
      const r = SELECTION_PAD + a.width / 2;
      return Boolean(b && x >= b[0] - r && x <= b[2] + r && y >= b[1] - r && y <= b[3] + r);
    });
  }
  /** Change the selection as one step of undo. */
  function editSelection(fn: (keys: string[]) => void): void {
    if (!sel) return;
    session.begin();
    fn(sel.keys);
    session.end();
    showSelection();
  }

  // --- the bar --------------------------------------------------------------
  const bar = createInkBar(env.body, {
    tool: (t) => setTool(t),
    color: (c) => {
      if (sel) return editSelection((keys) => session.restyle(keys, { color: c }));
      prefs.color = c;
      saveInkPrefs(prefs);
      syncBar();
    },
    width: (w, doneDragging) => {
      if (sel) {
        // One restyle when the slider is let go; it is only a preview
        // until then.
        if (doneDragging) editSelection((keys) => session.restyle(keys, { width: w }));
        return;
      }
      if (prefs.tool === "eraser") prefs.eraser = w;
      else prefs.width = w;
      if (doneDragging) saveInkPrefs(prefs);
      syncBar();
    },
    undo: () => undo(),
    redo: () => redo(),
    remove: () => {
      editSelection((keys) => session.remove(keys));
      sel = null;
      showSelection();
    },
  });
  // In the bottom bar, right after the pen button.
  env.button.after(bar.el);

  function syncBar(): void {
    // A selection (the select tool's, or a finger's in any tool) is
    // what the colours and width act on.
    const list = selected();
    const colors = new Set(list.map((a) => a.color));
    bar.sync({
      tool: prefs.tool,
      color: list.length ? (colors.size === 1 ? list[0].color : null) : prefs.color,
      width: list.length ? list[0].width : prefs.width,
      eraser: prefs.eraser,
      selected: list.length,
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
    });
  }
  session.onChange(syncBar);

  function setTool(t: InkTool): void {
    if (t === prefs.tool) return;
    if (prefs.tool !== "eraser") previousTool = prefs.tool;
    prefs.tool = t;
    saveInkPrefs(prefs);
    if (t !== "select") select(0, []);
    live.showCursor(null);
    syncBar();
  }

  function undo(): void {
    if (session.undo()) showSelection();
  }
  function redo(): void {
    if (session.redo()) showSelection();
  }

  // --- the pen --------------------------------------------------------------
  const input = attachInkInput({
    scrollArea: env.scrollArea,
    getPages: env.getPages,
    live,
    tool: () => prefs.tool,
    penStyle: () => ({ color: inkStrokeColor(prefs.color), width: prefs.width }),
    eraserSize: () => prefs.eraser,
    // Drawing or erasing lets go of a selection a finger made.
    begin: () => {
      if (prefs.tool !== "select" && sel) select(0, []);
      writer?.writing?.();
      env.onPenDown?.();
      session.begin();
    },
    end: () => {
      writer?.writing?.();
      session.end();
    },
    stroke: (idx, points) => {
      // A stroke too long for one annotation becomes several.
      const path = smoothPath(points);
      for (const piece of splitLongPath(path, Math.floor(MAX_POSITION_CHARS / 20))) {
        session.addStroke(idx, piece, { color: prefs.color, width: prefs.width });
      }
    },
    erase: (idx, from, to) => session.eraseAlong(idx, from, to, prefs.eraser),
    grabbable: (idx, [x, y], reach) => selectionHas(idx, x, y) || Boolean(session.hit(idx, x, y, reach)),
    press: (idx, [x, y], reach) => {
      if (selectionHas(idx, x, y)) return true;
      const a = session.hit(idx, x, y, reach);
      select(idx, a ? [a.key] : []);
      return Boolean(a);
    },
    drag: (dx, dy) => {
      if (!sel) return;
      layer.setOffset(sel.idx, sel.keys, dx, dy);
      showSelection(dx, dy);
    },
    drop: (dx, dy) => {
      if (!sel) return;
      layer.setOffset(sel.idx, sel.keys, 0, 0);
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) editSelection((keys) => session.translate(keys, dx, dy));
      else showSelection();
    },
    sweep: (idx, rect) => select(idx, rect ? session.within(idx, rect).map((a) => a.key) : []),
    pressOutside: () => select(0, []),
  });

  // --- on and off -----------------------------------------------------------
  function onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented || t?.closest("input, textarea, [contenteditable]")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault();
      editSelection((keys) => session.remove(keys));
    } else if (e.key === "Escape" && sel) {
      e.preventDefault();
      select(0, []);
    }
  }

  /** A Pencil double-tap: the eraser and back, always — the system's
   *  "switch to last used tool" would do nothing from the pen, and its
   *  colour palette has no equivalent here. A squeeze follows the
   *  system's setting. */
  function onPencil(e: Event): void {
    const { kind, action } = (e as CustomEvent<{ kind?: string; action?: string }>).detail ?? {};
    // The notepad's, when the Pencil was last on it.
    if (!active || input.busy() || pencilOnNotepad()) return;
    const back = previousTool === "eraser" ? "pen" : previousTool;
    if (kind === "tap" || action === "switchEraser") setTool(prefs.tool === "eraser" ? back : "eraser");
    else if (action === "switchPrevious") setTool(prefs.tool === previousTool ? "pen" : previousTool);
  }

  // A drawing a finger picked up stays selected for the bar's colours
  // and Delete — until the finger turns to the text: a new selection
  // there lets go of it (a tap off the drawing does too, input.ts).
  function onSelectionChange(): void {
    if (!sel || input.busy()) return;
    const s = document.getSelection();
    if (s && !s.isCollapsed && s.anchorNode && env.scrollArea.contains(s.anchorNode)) select(0, []);
  }

  // Changes still waiting are written before the app is put away —
  // ahead of the annotation push that the same event starts.
  const flushNow = () => session.flush();
  const onHidden = () => document.visibilityState === "hidden" && flushNow();

  function setActive(on: boolean): void {
    if (!writer || on === active) return;
    if (on) env.onStart();
    active = on;
    env.button.classList.toggle("active", on);
    env.scrollArea.classList.toggle("pdf-ink-active", on);
    env.onActiveChange?.(on);
    bar.show(on);
    input.setEnabled(on);
    if (on) {
      live.attach();
      window.addEventListener("keydown", onKey);
      window.addEventListener("zh-pencil", onPencil);
      document.addEventListener("selectionchange", onSelectionChange);
      syncBar();
    } else {
      select(0, []);
      session.flush();
      live.detach();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("zh-pencil", onPencil);
      document.removeEventListener("selectionchange", onSelectionChange);
    }
  }

  if (writer) env.button.addEventListener("click", () => setActive(!active));
  else env.button.style.display = "none";
  window.addEventListener("visibilitychange", onHidden, true);
  window.addEventListener("pagehide", flushNow);

  return {
    /** The pen's colour and the colours it may take, for reading mode's
     *  pen flyout — which sets the pen's own colour, not a selection's. */
    pen: {
      palette: [...ANNOTATION_COLORS, ...INK_EXTRA_COLORS],
      color: () => prefs.color,
      setColor(c: string): void {
        prefs.color = c;
        saveInkPrefs(prefs);
        syncBar();
      },
    },
    isActive: () => active,
    /** A stroke (or an erase, a drag) is under way. */
    isDrawing: () => input.busy(),
    setActive,
    /** The PDF's annotations changed; its ink is picked out of them. */
    setAnnotations(list: Annotation[]): void {
      const ink: InkAnn[] = [];
      for (const a of list) {
        if (a.type !== "ink") continue;
        let one = inkOf.get(a);
        if (one === undefined) {
          const pos = annotationPosition(a);
          const raw = (a._raw.data as Record<string, unknown>).annotationPosition;
          one =
            pos?.paths && typeof pos.pageIndex === "number"
              ? {
                  key: a.key,
                  pageIndex: pos.pageIndex,
                  color: a.color || "#000000",
                  width: Number(pos.width) || 1,
                  paths: pos.paths,
                  pos: typeof raw === "string" ? raw : JSON.stringify(raw),
                  editable: writer ? writer.canEdit(a) : false,
                }
              : null;
          inkOf.set(a, one);
        }
        if (one) ink.push(one);
      }
      session.setBase(ink);
      if (sel) showSelection();
    },
    pageRendered: (idx: number) => layer.pageRendered(idx),
    /** A new document: forget the old one's pages. */
    reset: () => {
      session.flush();
      layer.reset();
      sel = null;
    },
    destroy(): void {
      setActive(false);
      session.flush();
      session.destroy();
      input.destroy();
      window.removeEventListener("visibilitychange", onHidden, true);
      window.removeEventListener("pagehide", flushNow);
      bar.destroy();
    },
  };
}

export type InkToolHandle = ReturnType<typeof createInkTool>;
