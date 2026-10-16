// Ink mode's tools, in the viewer's bottom bar right after the pen
// button that turns them on: pen / eraser / select; one chip for the
// colour and width — a dot in the colour, the width as a number — that
// opens a small popup with Zotero's ink colours (its eight, and black)
// and a width slider (the eraser's size, with the eraser); undo, redo,
// and delete for a selection. With a selection, the colours and width
// restyle it. Kept in the bar, not over the pages, so they take no room
// from what is being written on.
//
// The choices are this device's (`localStorage`), like the selection
// bar's highlight / underline switch.
import { ANNOTATION_COLORS } from "../../lib/highlights";
import { DEFAULT_ERASER_SIZE, DEFAULT_PEN_WIDTH, ERASER_SIZES, INK_EXTRA_COLORS, PEN_WIDTHS } from "./geometry";
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
      width: PEN_WIDTHS.includes(raw.width as number) ? (raw.width as number) : d.width,
      eraser: ERASER_SIZES.includes(raw.eraser as number) ? (raw.eraser as number) : d.eraser,
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

/** The step nearest a width — a drawing made elsewhere may have one
 *  between (or beyond) the slider's steps. */
const nearest = (steps: ReadonlyArray<number>, w: number) =>
  steps.reduce((best, s, i) => (Math.abs(s - w) < Math.abs(steps[best] - w) ? i : best), 0);

/** "2", "0.5", "16.5". */
const fmt = (w: number) => String(Math.round(w * 100) / 100);

/** `popupHost`: where the colour / width popup goes (the viewer's body,
 *  which it is placed in above the bar). */
export function createInkBar(popupHost: HTMLElement, handlers: InkBarHandlers) {
  const el = document.createElement("span");
  el.className = "pdf-toolbar-section pdf-ink-tools";
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

  // The chip: the colour as a dot, the width beside it.
  const chip = button("pdf-zoom-btn pdf-ink-chip", "Colour and width", "", () => toggleMenu());
  const dot = document.createElement("span");
  dot.className = "pdf-ink-chip-dot";
  const num = document.createElement("span");
  num.className = "pdf-ink-chip-num";
  chip.append(dot, num);

  const undo = button("pdf-zoom-btn", "Undo", UNDO_ICON, handlers.undo);
  undo.dataset.shortcut = "mod+z";
  const redo = button("pdf-zoom-btn", "Redo", REDO_ICON, handlers.redo);
  redo.dataset.shortcut = "mod+shift+z";
  const del = button("pdf-zoom-btn pdf-ink-delete", "Delete the selection", TRASH_ICON, handlers.remove);

  el.append(group("pdf-toggle-group", tools.pen, tools.eraser, tools.select), chip, group("pdf-toggle-group", undo, redo), del);

  // --- the popup: colours over a width slider ------------------------------
  const menu = document.createElement("div");
  menu.className = "pdf-ink-menu";
  menu.style.display = "none";
  const swatches = [...ANNOTATION_COLORS, ...INK_EXTRA_COLORS].map((c) => {
    const s = button("pdf-mark-swatch", "", "", () => handlers.color(c));
    s.style.setProperty("--swatch", c);
    s.dataset.color = c;
    return s;
  });
  const colors = group("pdf-ink-colors", ...swatches);
  // The slider runs over the steps' indices, so each step is one notch.
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.step = "1";
  slider.className = "pdf-ink-width";
  const label = document.createElement("span");
  label.className = "pdf-ink-width-label";
  let steps: ReadonlyArray<number> = PEN_WIDTHS;
  const value = () => steps[Number(slider.value)] ?? steps[0];
  slider.addEventListener("input", () => {
    label.textContent = `${fmt(value())} pt`;
    handlers.width(value(), false);
  });
  slider.addEventListener("change", () => {
    handlers.width(value(), true);
    // Let go, so the keys are the viewer's again.
    slider.blur();
  });
  menu.append(colors, group("pdf-ink-width-wrap", slider, label));
  popupHost.appendChild(menu);

  let last: InkBarState | null = null;

  function placeMenu(): void {
    const h = popupHost.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const left = c.left + c.width / 2 - h.left - menu.offsetWidth / 2;
    menu.style.left = `${Math.max(8, Math.min(left, h.width - menu.offsetWidth - 8))}px`;
  }
  function closeMenu(): void {
    menu.style.display = "none";
    chip.classList.remove("active");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onEscape, true);
  }
  function onOutside(e: PointerEvent): void {
    const t = e.target as Node;
    if (!menu.contains(t) && !chip.contains(t)) closeMenu();
  }
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeMenu();
  }
  function toggleMenu(): void {
    if (menu.style.display !== "none") return closeMenu();
    menu.style.display = "";
    chip.classList.add("active");
    if (last) sync(last);
    placeMenu();
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onEscape, true);
  }

  function sync(s: InkBarState): void {
    last = s;
    for (const t of Object.keys(tools) as InkTool[]) tools[t].classList.toggle("active", s.tool === t);
    const erasing = s.tool === "eraser";
    // Select with nothing selected has nothing to colour or size.
    const styling = !(s.tool === "select" && !s.selected);
    const w = erasing ? s.eraser : s.width;
    chip.style.display = styling ? "" : "none";
    chip.classList.toggle("eraser", erasing);
    chip.title = erasing ? "Eraser size" : s.selected ? "Colour and width of the selection" : "Pen colour and width";
    dot.style.background = erasing ? "transparent" : s.color ?? "var(--text-dim)";
    num.textContent = fmt(w);
    if (!styling) closeMenu();
    colors.style.display = erasing ? "none" : "";
    for (const sw of swatches) sw.classList.toggle("active", sw.dataset.color === s.color);
    steps = erasing ? ERASER_SIZES : PEN_WIDTHS;
    slider.max = String(steps.length - 1);
    if (document.activeElement !== slider) slider.value = String(nearest(steps, w));
    label.textContent = `${fmt(w)} pt`;
    undo.disabled = !s.canUndo;
    redo.disabled = !s.canRedo;
    del.style.display = s.selected ? "" : "none";
    if (menu.style.display !== "none") placeMenu();
  }

  return {
    el,
    sync,
    show(on: boolean): void {
      el.style.display = on ? "" : "none";
      if (!on) closeMenu();
    },
    destroy(): void {
      closeMenu();
      el.remove();
      menu.remove();
    },
  };
}
