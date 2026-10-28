// The ink being edited in the open PDF: Zotero's ink annotations, with
// this viewer's changes laid over them until they are written.
//
// Writing fast is the case this is built for. Every write to the store
// re-renders React around the viewer, and every outbox write is an IPC
// round trip; done per stroke, both land in the middle of the next
// stroke and cost it samples. So a change goes to the drawing at once
// (layer.ts) and into `local` here, and reaches the store and the
// outbox only once the pen has rested (FLUSH_IDLE_MS) — or on leaving
// ink mode, closing the PDF, or the app going to the background. Until
// then the store's view of an annotation is overridden by `local`, so
// a sync landing mid-sentence doesn't undo what was just written.
//
// Strokes are added to the last ink annotation the way Zotero's reader
// adds them (geometry.ts), so a word or a margin note is one annotation,
// not thirty.
import {
  erasePaths,
  hitsPaths,
  inPolygon,
  MAX_POSITION_CHARS,
  MERGE_DISTANCE,
  MERGE_MS,
  pathsBounds,
  rectDistance,
  rectsIntersect,
  translatePaths,
  type Rect,
} from "./geometry";
import type { InkAnn, InkLayer } from "./layer";

/** How long the pen rests before its changes are written — long enough
 *  to be past the pause between two words or two lines, since the
 *  write re-renders what watches the library and would land on the
 *  start of the next stroke. */
const FLUSH_IDLE_MS = 2000;
/** Writing without a pause doesn't hold changes back longer than this:
 *  past it they are written at the next pen-up. */
const FLUSH_MAX_MS = 15_000;
const UNDO_LIMIT = 100;

export interface InkStyle {
  color: string;
  width: number;
}

/** What a flush hands on, one call per changed annotation. */
export interface InkSink {
  create: (a: InkAnn) => void;
  update: (a: InkAnn, before: InkAnn) => void;
  remove: (key: string) => void;
  newKey: () => string;
}

type Snapshot = Map<string, InkAnn | null>;

export function positionOf(pageIndex: number, width: number, paths: number[][]): string {
  return JSON.stringify({ pageIndex, width, paths });
}

function make(base: Omit<InkAnn, "pos" | "bounds">): InkAnn {
  // Made from another (`{ ...a, paths }`), it would carry that one's
  // bounds along: they are measured again from the new paths.
  return { ...base, bounds: undefined, pos: positionOf(base.pageIndex, base.width, base.paths) };
}

export function boundsOf(a: InkAnn): Rect | null {
  if (a.bounds === undefined) a.bounds = pathsBounds(a.paths);
  return a.bounds;
}

export function createInkSession(layer: InkLayer, sink: InkSink) {
  let base = new Map<string, InkAnn>();
  const local = new Map<string, InkAnn | null>();
  /** The merged view, by page, in drawing order. */
  let byPage = new Map<number, Map<string, InkAnn>>();
  let last: { key: string; at: number } | null = null;
  const undoStack: Snapshot[] = [];
  const redoStack: Snapshot[] = [];
  let group: Snapshot | null = null;
  let flushTimer = 0;
  let dirtySince = 0;
  let onChange: () => void = () => {};

  const get = (key: string) => (local.has(key) ? local.get(key) ?? null : base.get(key) ?? null);

  function indexAll(): void {
    byPage = new Map();
    const put = (a: InkAnn) => {
      let m = byPage.get(a.pageIndex);
      if (!m) byPage.set(a.pageIndex, (m = new Map()));
      m.set(a.key, a);
    };
    for (const [k, a] of base) if (!local.has(k)) put(a);
    for (const a of local.values()) if (a) put(a);
  }

  const pageList = (idx: number) => [...(byPage.get(idx)?.values() ?? [])];

  /** The one way an annotation changes: drawn at once, remembered for
   *  undo and for the next flush. */
  function set(key: string, next: InkAnn | null, record = true): void {
    const prev = get(key);
    if (record && group && !group.has(key)) group.set(key, prev);
    local.set(key, next);
    const pages = new Set<number>();
    if (prev) {
      byPage.get(prev.pageIndex)?.delete(key);
      pages.add(prev.pageIndex);
    }
    if (next) {
      let m = byPage.get(next.pageIndex);
      if (!m) byPage.set(next.pageIndex, (m = new Map()));
      m.set(key, next);
      pages.add(next.pageIndex);
    }
    for (const p of pages) layer.render(p, pageList(p));
    if (!dirtySince) dirtySince = Date.now();
  }

  /** The store's ink for this PDF changed (a flush arriving back, a
   *  sync). Pages are redrawn only where something differs. */
  function setBase(list: InkAnn[]): void {
    const before = new Set(byPage.keys());
    base = new Map(list.map((a) => [a.key, a]));
    indexAll();
    for (const p of new Set([...before, ...byPage.keys()])) layer.render(p, pageList(p));
    onChange();
  }

  /** Pen-down: changes until `end()` are one step of undo, and nothing
   *  is written while the pen is on the page. */
  function begin(): void {
    clearTimeout(flushTimer);
    group = new Map();
  }

  function end(): void {
    if (group?.size) {
      undoStack.push(group);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    group = null;
    if (!local.size) return;
    if (Date.now() - dirtySince > FLUSH_MAX_MS) flush();
    else flushTimer = window.setTimeout(flush, FLUSH_IDLE_MS);
    onChange();
  }

  /** A finished stroke (PDF points), added to the last annotation when
   *  Zotero would add it there. Returns the annotation's key. */
  function addStroke(pageIndex: number, path: number[], style: InkStyle): string {
    const bounds = pathsBounds([path]);
    const prev = last ? get(last.key) : null;
    const extra = path.length * 9 + 2;
    const join =
      prev &&
      bounds &&
      prev.editable &&
      prev.pageIndex === pageIndex &&
      prev.color === style.color &&
      prev.width === style.width &&
      Date.now() - last!.at < MERGE_MS &&
      prev.pos.length + extra < MAX_POSITION_CHARS &&
      rectDistance(boundsOf(prev)!, bounds) < MERGE_DISTANCE;
    const key = join ? prev!.key : sink.newKey();
    const paths = join ? [...prev!.paths, path] : [path];
    set(key, make({ key, pageIndex, color: style.color, width: style.width, paths, editable: true }));
    last = { key, at: Date.now() };
    return key;
  }

  /** Erase along a short move (PDF points), stepping so a quick swipe
   *  can't jump over a line. */
  function eraseAlong(pageIndex: number, from: [number, number] | null, to: [number, number], diameter: number): void {
    const steps = from ? Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (diameter / 3))) : 1;
    for (let s = 1; s <= steps; s++) {
      const x = from ? from[0] + ((to[0] - from[0]) * s) / steps : to[0];
      const y = from ? from[1] + ((to[1] - from[1]) * s) / steps : to[1];
      const r = diameter / 2;
      const circle: Rect = [x - r, y - r, x + r, y + r];
      for (const a of pageList(pageIndex)) {
        if (!a.editable) continue;
        const b = boundsOf(a);
        if (!b || !rectsIntersect([b[0] - a.width, b[1] - a.width, b[2] + a.width, b[3] + a.width], circle)) continue;
        const paths = erasePaths(a.paths, x, y, diameter);
        if (paths) set(a.key, paths.length ? make({ ...a, paths }) : null);
      }
    }
  }

  /** The topmost editable annotation drawn at a point. */
  function hit(pageIndex: number, x: number, y: number, reach: number): InkAnn | null {
    const list = pageList(pageIndex);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const b = boundsOf(a);
      if (!a.editable || !b) continue;
      const r = a.width / 2 + reach;
      if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
      if (hitsPaths(a.paths, a.width, x, y, reach)) return a;
    }
    return null;
  }

  /** The editable drawings on a page with a point inside a lasso's
   *  loop (PDF points, x, y pairs). */
  function inLoop(pageIndex: number, loop: number[]): InkAnn[] {
    const box = pathsBounds([loop]);
    if (!box) return [];
    return pageList(pageIndex).filter((a) => {
      const b = boundsOf(a);
      if (!a.editable || !b || !rectsIntersect(b, box)) return false;
      return a.paths.some((p) => p.some((_, i) => i % 2 === 0 && inPolygon(p[i], p[i + 1], loop)));
    });
  }

  function translate(keys: string[], dx: number, dy: number): void {
    for (const k of keys) {
      const a = get(k);
      if (a) set(k, make({ ...a, paths: translatePaths(a.paths, dx, dy) }));
    }
  }

  function restyle(keys: string[], style: Partial<InkStyle>): void {
    for (const k of keys) {
      const a = get(k);
      if (!a) continue;
      // The same paths array: the layer restyles without redrawing.
      const next = { ...a, ...style, pos: positionOf(a.pageIndex, style.width ?? a.width, a.paths) };
      if (next.color !== a.color || next.width !== a.width) set(k, next);
    }
  }

  function remove(keys: string[]): void {
    for (const k of keys) if (get(k)) set(k, null);
  }

  function replay(from: Snapshot[], to: Snapshot[]): boolean {
    const snap = from.pop();
    if (!snap) return false;
    const back: Snapshot = new Map();
    for (const [k, a] of snap) {
      back.set(k, get(k));
      set(k, a, false);
    }
    to.push(back);
    last = null; // the next stroke starts an annotation of its own
    clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, FLUSH_IDLE_MS);
    onChange();
    return true;
  }

  /** Hand every change on: created, changed, deleted. */
  function flush(): void {
    clearTimeout(flushTimer);
    if (group) return; // the pen is down; its end() flushes
    for (const [key, a] of local) {
      const before = base.get(key);
      if (!a) {
        if (before) sink.remove(key);
        base.delete(key);
      } else if (!before) {
        sink.create(a);
        base.set(key, a);
      } else {
        if (before.pos !== a.pos || before.color !== a.color) sink.update(a, before);
        base.set(key, a);
      }
    }
    local.clear();
    dirtySince = 0;
    onChange();
  }

  return {
    setBase,
    begin,
    end,
    addStroke,
    eraseAlong,
    hit,
    inLoop,
    translate,
    restyle,
    remove,
    get,
    undo: () => replay(undoStack, redoStack),
    redo: () => replay(redoStack, undoStack),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    flush,
    /** Called after anything the bar shows may have changed. */
    onChange: (fn: () => void) => (onChange = fn),
    destroy: () => clearTimeout(flushTimer),
  };
}

export type InkSession = ReturnType<typeof createInkSession>;
