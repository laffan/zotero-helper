// The ink bar: floating over the foot of the pages while ink mode is
// on — over them, not beside them, so starting to draw doesn't take
// room from the pages and set off a relayout and re-render of every
// page in a fit-to-height view. Pen / eraser / select; Zotero's ink colours (its eight, and
// black); the pen width over Zotero's own range (0.2–25pt) or, with the
// eraser, the eraser's size; undo and redo; delete for a selection; and
// Done. With a selection, the colours and the width restyle it.
//
// The choices are this device's (`localStorage`), like the selection
// bar's highlight / underline switch.
import { ANNOTATION_COLORS } from "../../lib/highlights";
import { DEFAULT_ERASER_SIZE, DEFAULT_PEN_WIDTH, INK_EXTRA_COLORS, INK_WIDTHS } from "./geometry";
import { ERASER_ICON, PEN_ICON, REDO_ICON, SELECT_ICON, TRASH_ICON, UNDO_ICON } from "./icons";
import type { InkTool } from "./input";

const PREFS_KEY = "zh-ink";

export interface InkPrefs {
  tool: InkTool;
  color: string;
  width: number;
  eraser: number;
}

export function loadInkPrefs(): InkPrefs {
  const d: InkPrefs = { tool: "pen", color: ANNOTATION_COLORS[3], width: DEFAULT_PEN_WIDTH, eraser: DEFAULT_ERASER_SIZE };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<InkPrefs>;
    return {
      tool: raw.tool === "eraser" || raw.tool === "select" ? raw.tool : "pen",
      color: typeof raw.color === "string" ? raw.color : d.color,
      width: INK_WIDTHS.includes(raw.width as number) ? (raw.width as number) : d.width,
      eraser: INK_WIDTHS.includes(raw.eraser as number) ? (raw.eraser as number) : d.eraser,
    };
  } catch {
    return d;
  }
}

export function saveInkPrefs(p: InkPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts the session */
  }
}

export interface InkBarHandlers {
  tool: (t: InkTool) => void;
  color: (c: string) => void;
  /** A width step chosen; `done` once the slider is let go. */
  width: (w: number, done: boolean) => void;
  undo: () => void;
  redo: () => void;
  remove: () => void;
  close: () => void;
}

export interface InkBarState {
  tool: InkTool;
  /** The colour and width shown: the pen's, or the selection's. */
  color: string | null;
  width: number;
  eraser: number;
  selected: number;
  canUndo: boolean;
  canRedo: boolean;
}

export function createInkBar(handlers: InkBarHandlers) {
  const el = document.createElement("div");
  el.className = "pdf-ink-bar";
  el.style.display = "none";

  const button = (cls: string, title: string, html: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = title;
    b.innerHTML = html;
    b.addEventListener("click", fn);
    return b;
  };
  const group = (cls: string, ...kids: HTMLElement[]) => {
    const g = document.createElement("span");
    g.className = cls;
    g.append(...kids);
    return g;
  };

  const tools: Record<InkTool, HTMLButtonElement> = {
    pen: button("pdf-toggle-option", "Pen", PEN_ICON, () => handlers.tool("pen")),
    eraser: button("pdf-toggle-option", "Eraser — or double-tap the Pencil", ERASER_ICON, () => handlers.tool("eraser")),
    select: button("pdf-toggle-option", "Select drawings: tap one, or drag a box", SELECT_ICON, () => handlers.tool("select")),
  };
  for (const t of Object.keys(tools) as InkTool[]) tools[t].dataset.inkTool = t;

  const swatches = [...ANNOTATION_COLORS, ...INK_EXTRA_COLORS].map((c) => {
    const s = button("pdf-mark-swatch", "", "", () => handlers.color(c));
    s.style.setProperty("--swatch", c);
    s.dataset.color = c;
    return s;
  });
  const colors = group("pdf-ink-colors", ...swatches);

  // The width as a step index over Zotero's steps, so the slider moves
  // as Zotero's does (fine at the thin end, half points above).
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(INK_WIDTHS.length - 1);
  slider.step = "1";
  slider.className = "pdf-ink-width";
  const label = document.createElement("span");
  label.className = "pdf-ink-width-label";
  const step = () => INK_WIDTHS[Number(slider.value)] ?? DEFAULT_PEN_WIDTH;
  slider.addEventListener("input", () => {
    label.textContent = `${step()} pt`;
    handlers.width(step(), false);
  });
  slider.addEventListener("change", () => {
    handlers.width(step(), true);
    // Let go, so the keys are the viewer's again.
    slider.blur();
  });
  const width = group("pdf-ink-width-wrap", slider, label);

  const undo = button("pdf-zoom-btn", "Undo", UNDO_ICON, handlers.undo);
  undo.dataset.shortcut = "mod+z";
  const redo = button("pdf-zoom-btn", "Redo", REDO_ICON, handlers.redo);
  redo.dataset.shortcut = "mod+shift+z";
  const del = button("pdf-zoom-btn pdf-ink-delete", "Delete the selection", TRASH_ICON, handlers.remove);
  const done = button("pdf-zoom-btn pdf-ink-done", "Leave ink mode", "Done", handlers.close);
  done.dataset.shortcut = "pdfInk";

  el.append(
    group("pdf-toggle-group", tools.pen, tools.eraser, tools.select),
    colors,
    width,
    group("pdf-toolbar-section", undo, redo, del),
    done,
  );

  function sync(s: InkBarState): void {
    for (const t of Object.keys(tools) as InkTool[]) tools[t].classList.toggle("active", s.tool === t);
    const erasing = s.tool === "eraser";
    // The colours and width apply to the pen, or to what is selected.
    colors.style.display = erasing || (s.tool === "select" && !s.selected) ? "none" : "";
    for (const sw of swatches) sw.classList.toggle("active", sw.dataset.color === s.color);
    const w = erasing ? s.eraser : s.width;
    width.style.display = s.tool === "select" && !s.selected ? "none" : "";
    width.title = erasing ? "Eraser size" : "Pen width";
    if (document.activeElement !== slider) slider.value = String(Math.max(0, INK_WIDTHS.indexOf(w)));
    label.textContent = `${w} pt`;
    undo.disabled = !s.canUndo;
    redo.disabled = !s.canRedo;
    del.style.display = s.selected ? "" : "none";
  }

  return {
    el,
    sync,
    show: (on: boolean) => (el.style.display = on ? "" : "none"),
  };
}
