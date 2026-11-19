// Sections the reader adds to the pages (kept by lib/dividers.ts, which
// files the highlights under them in the Highlights tab). Add Section —
// the bottom bar's button beside the sentence tool, reading mode's below
// its caret, or A — readies the tool: a dashed guide follows the pointer
// across the page under it, and the next tap on a page puts a section's
// line there, with the naming box (nameBox.ts) under its label — filled
// with the line of text just below, which is usually the heading the
// section begins at, selected so typing replaces it. Add keeps it;
// Escape or a press elsewhere drops it. Either way the tool is done: it
// places one line per press of the button (or turns off with a second
// press, or Escape).
//
// A section shows as a dashed line across its page with its name in a
// tab at the left, above the line. The tab is the section's handle: a tap
// opens the box to rename it or Remove it, a drag moves the line up or
// down its page. Adding one or renaming it, the box also offers the
// sections before it that it can be nested under (lib/dividers.ts).
//
// While the tool is ready it has every press on the pages to itself —
// heard on the window before anything in the pages (the sentence tool,
// highlights, ink, the Pencil's own handling) — and the click that ends
// the tap. A finger's drag still scrolls; only a tap places.
//
// Like the explained passages (passageMarks.ts), the lines are an
// overlay on each page wrapper in percentages of the page, so they
// follow every zoom with no raster; a page drawn for the first time may
// adopt its own size (pageSizes.ts), so its lines are placed again then.
// Heights are kept in PDF units (y up), as the outline's are, so a
// section files highlights the way a heading does.
import { createNameBox } from "./nameBox";
import type { PageRecord } from "./types";
import type { PdfViewerOptions } from "./viewerOptions";

/** A section as a page shows it. */
export interface PageDivider {
  id: string;
  pageIndex: number;
  /** PDF units, y up. */
  top: number;
  name: string;
  /** The section it is nested under. */
  parentId?: string;
}

interface DividersEnv {
  root: HTMLElement;
  scrollArea: HTMLElement;
  /** The bottom bar's Add Section. */
  button: HTMLElement;
  opts: PdfViewerOptions;
  getPages: () => PageRecord[];
  getPageLabels: () => string[] | null;
  /** The tool is readied: the folded view, which shows strips of pages,
   *  is left for whole ones. */
  onStart: () => void;
}

/** A press that moves this far is a scroll or a drag, not a tap. */
const TAP_PX = 8;
/** How far below the line the text that names it may start, CSS px. */
const NAME_REACH_PX = 60;
const NAME_MAX = 80;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The PDF height of a point a fraction `fy` down page `p`, and back. */
const heightAt = (p: PageRecord, fy: number) => p.viewport.convertToPdfPoint(0, clamp01(fy) * p.viewport.height)[1];
const fractionAt = (p: PageRecord, top: number) => clamp01(p.viewport.convertToViewportPoint(0, top)[1] / p.viewport.height);

/** The page wrapper a press landed on, and its index — whole pages only,
 *  not their buttons or a section's tab. */
function pageAt(target: EventTarget | null): { wrapper: HTMLElement; idx: number } | null {
  const el = target instanceof Element ? target : null;
  if (!el || el.closest("button, a, input, textarea, .pdf-divider-label")) return null;
  const wrapper = el.closest<HTMLElement>(".pdf-page-wrapper");
  const idx = Number(wrapper?.dataset.pageIndex ?? NaN);
  return wrapper && Number.isInteger(idx) ? { wrapper, idx } : null;
}

/** The first line of text on the page starting just below client height
 *  `y` — what a section put there is likely to be called. */
function textBelow(wrapper: HTMLElement, y: number): string {
  let best = Infinity;
  const lines = new Map<number, { x: number; text: string }[]>();
  for (const span of wrapper.querySelectorAll<HTMLElement>(".textLayer span:not(.markedContent)")) {
    const text = span.textContent ?? "";
    if (!text.trim()) continue;
    const r = span.getBoundingClientRect();
    if (r.top < y - 4 || r.top > y + NAME_REACH_PX || r.top > best + 3) continue;
    const key = Math.round(r.top);
    best = Math.min(best, r.top);
    lines.set(key, [...(lines.get(key) ?? []), { x: r.left, text }]);
  }
  if (best === Infinity) return "";
  const line = [...lines.entries()]
    .filter(([top]) => Math.abs(top - best) <= 3)
    .flatMap(([, parts]) => parts)
    .sort((a, b) => a.x - b.x)
    .map((p) => p.text)
    .join(" ");
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length > NAME_MAX ? `${clean.slice(0, NAME_MAX - 1).trimEnd()}…` : clean;
}

/** A line across a page at fraction `fy`, with its tab. */
function lineEl(fy: number, name: string, cls = "pdf-divider"): HTMLElement {
  const line = document.createElement("div");
  line.className = cls;
  line.style.top = `${fy * 100}%`;
  const label = document.createElement("button");
  label.type = "button";
  label.className = "pdf-divider-label";
  label.textContent = name;
  line.appendChild(label);
  return line;
}

export function createDividers(env: DividersEnv) {
  const { opts, scrollArea } = env;
  const box = createNameBox(env.root);
  let marks: PageDivider[] = [];
  let placing = false;
  // The guide: where a line would go, following the pointer (or, once a
  // tap has placed it, the line being named).
  let guide: HTMLElement | null = null;
  let press: { id: number; x: number; y: number; wrapper: HTMLElement; idx: number } | null = null;
  // The click that ends a tap the tool took isn't the pages'.
  let eatClickUntil = 0;

  function showGuide(wrapper: HTMLElement, fy: number, name = ""): HTMLElement {
    if (!guide || guide.parentElement !== wrapper) {
      guide?.remove();
      guide = lineEl(fy, name, "pdf-divider pdf-divider-guide");
      wrapper.appendChild(guide);
    }
    guide.style.top = `${fy * 100}%`;
    guide.querySelector(".pdf-divider-label")!.textContent = name;
    return guide;
  }
  function hideGuide(): void {
    guide?.remove();
    guide = null;
  }

  function setPlacing(on: boolean): void {
    if (on === placing) return;
    placing = on;
    env.button.classList.toggle("active", on);
    scrollArea.classList.toggle("pdf-divider-placing", on);
    opts.onSectionTool?.(on);
    if (on) {
      env.onStart();
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("keydown", onKey, true);
      scrollArea.addEventListener("pointermove", onHover);
      scrollArea.addEventListener("pointerleave", onLeave);
    } else {
      press = null;
      if (!box.isOpen()) hideGuide();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      scrollArea.removeEventListener("pointermove", onHover);
      scrollArea.removeEventListener("pointerleave", onLeave);
    }
  }

  /** A mouse or a hovering Pencil over a page: the guide follows it. */
  function onHover(e: PointerEvent): void {
    if (press || box.isOpen() || e.pointerType === "touch") return;
    const at = pageAt(e.target);
    if (!at) return hideGuide();
    const r = at.wrapper.getBoundingClientRect();
    showGuide(at.wrapper, clamp01((e.clientY - r.top) / r.height));
  }
  function onLeave(): void {
    if (!press && !box.isOpen()) hideGuide();
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!scrollArea.contains(e.target as Node)) return;
    const at = pageAt(e.target);
    if (!at) return;
    // The tool's, before anything in the pages hears it.
    e.preventDefault();
    e.stopPropagation();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, ...at };
    const r = at.wrapper.getBoundingClientRect();
    showGuide(at.wrapper, clamp01((e.clientY - r.top) / r.height));
  }

  function onUp(e: PointerEvent): void {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    eatClickUntil = performance.now() + 700;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_PX) return hideGuide();
    place(p.wrapper, p.idx, p.y);
  }
  function onCancel(e: PointerEvent): void {
    if (press && e.pointerId === press.id) {
      press = null;
      hideGuide();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Escape" || box.isOpen()) return;
    // Before reading mode's own Escape, which would leave it.
    e.preventDefault();
    e.stopPropagation();
    setPlacing(false);
  }

  /** A tap at client height `y` on page `idx`: the line, and its name. */
  function place(wrapper: HTMLElement, idx: number, y: number): void {
    const p = env.getPages()[idx];
    if (!p) return;
    const r = wrapper.getBoundingClientRect();
    const fy = clamp01((y - r.top) / r.height);
    const name = textBelow(wrapper, y) || "Section";
    const line = showGuide(wrapper, fy, name);
    const top = heightAt(p, fy);
    box.open({
      anchor: line.querySelector<HTMLElement>(".pdf-divider-label")!,
      align: "left",
      label: "Section name",
      name,
      existing: false,
      choice: nestChoice(idx, top),
      save: (n, parent) => {
        hideGuide();
        opts.onAddSection?.(idx, top, n, env.getPageLabels()?.[idx], parent || undefined);
      },
      dropped: hideGuide,
    });
    // Placed: the tool is done (the guide stays, as the line being
    // named, while the box is open).
    setPlacing(false);
  }

  /** The box's "Nested under": the sections one at `(idx, top)` can go
   *  under — none (the first choice) or one of those before it, still
   *  open there. Undefined when there are none. A section being renamed
   *  keeps its own; a new one starts beside the one before it (under
   *  that one's parent, the choice above it), as an outline's next line
   *  does. */
  function nestChoice(idx: number, top: number, exceptId?: string, current?: string) {
    const list = opts.sectionParents?.(idx, top, exceptId) ?? [];
    if (!list.length) return undefined;
    const value = exceptId
      ? current && list.some((c) => c.id === current) ? current : ""
      : (list[list.length - 2]?.id ?? "");
    return {
      label: "Nested under",
      options: [
        { value: "", text: "None" },
        ...list.map((c) => ({ value: c.id, text: c.name, level: c.level })),
      ],
      value,
    };
  }

  // A tab: a tap renames (or removes), a drag moves the line.
  function onTabDown(e: PointerEvent): void {
    const label = (e.target as Element).closest<HTMLElement>(".pdf-divider-label");
    const line = label?.parentElement;
    const mark = marks.find((m) => m.id === line?.dataset.dividerId);
    const wrapper = line?.parentElement?.parentElement;
    const p = mark ? env.getPages()[mark.pageIndex] : undefined;
    if (!label || !line || !mark || !wrapper || !p || line.classList.contains("pdf-divider-guide")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      label.setPointerCapture(e.pointerId);
    } catch {
      /* gone already */
    }
    const r = wrapper.getBoundingClientRect();
    const y0 = e.clientY;
    let dragged = false;
    let fy = fractionAt(p, mark.top);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      dragged ||= Math.abs(ev.clientY - y0) > 4;
      if (!dragged) return;
      fy = clamp01((ev.clientY - r.top) / r.height);
      line.style.top = `${fy * 100}%`;
      line.classList.add("dragging");
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      label.removeEventListener("pointermove", move);
      label.removeEventListener("pointerup", up);
      label.removeEventListener("pointercancel", up);
      line.classList.remove("dragging");
      eatClickUntil = performance.now() + 700;
      if (dragged) return opts.onMoveSection?.(mark.id, heightAt(p, fy));
      if (ev.type !== "pointerup") return;
      box.open({
        anchor: label,
        align: "left",
        label: "Section name",
        name: mark.name,
        existing: true,
        choice: nestChoice(mark.pageIndex, mark.top, mark.id, mark.parentId),
        save: (n, parent) => opts.onRenameSection?.(mark.id, n, parent || null),
        remove: () => opts.onRemoveSection?.(mark.id),
      });
    };
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
    label.addEventListener("pointercancel", up);
  }

  function onClick(e: MouseEvent): void {
    if (performance.now() > eatClickUntil) return;
    if (!scrollArea.contains(e.target as Node)) return;
    eatClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Page `idx`'s lines, drawn again from `marks`. */
  function drawPage(idx: number): void {
    const p = env.getPages()[idx];
    if (!p) return;
    p.wrapper.querySelector(":scope > .pdf-dividers")?.remove();
    const here = marks.filter((m) => m.pageIndex === idx);
    if (!here.length) return;
    const layer = document.createElement("div");
    layer.className = "pdf-dividers";
    for (const m of here) {
      const line = lineEl(fractionAt(p, m.top), m.name);
      line.dataset.dividerId = m.id;
      line.querySelector(".pdf-divider-label")!.setAttribute("title", "Tap to rename · drag to move");
      layer.appendChild(line);
    }
    p.wrapper.appendChild(layer);
  }

  const enabled = Boolean(opts.onAddSection);
  if (enabled) {
    env.button.addEventListener("click", () => setPlacing(!placing));
    scrollArea.addEventListener("pointerdown", onTabDown, true);
    window.addEventListener("click", onClick, true);
  } else env.button.style.display = "none";

  return {
    /** The PDF's sections, drawn on their pages. */
    set(list: PageDivider[]): void {
      const pages = new Set([...marks, ...list].map((m) => m.pageIndex));
      marks = list;
      for (const idx of pages) drawPage(idx);
    },
    /** A page was drawn, perhaps at a size of its own. */
    pageRendered(idx: number): void {
      if (marks.some((m) => m.pageIndex === idx)) drawPage(idx);
    },
    destroy(): void {
      setPlacing(false);
      box.close();
      hideGuide();
      scrollArea.removeEventListener("pointerdown", onTabDown, true);
      window.removeEventListener("click", onClick, true);
    },
  };
}
