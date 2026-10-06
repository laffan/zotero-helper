// The annotation shelf — the collapsible list at the viewer's right edge
// with a filter box and a colour row. Ported from Hush's
// src/pdf/pdf-viewer-annotations.js; the painting half of that module is
// paint.ts here, which draws into the page rasters instead of laying
// boxes over them.
//
// One addition over Hush: each shelf row can be sent to the notes
// (`onInsert`), which is what the shelf is for while taking notes.
import { annotationPosition, type Annotation } from "../lib/highlights";
import type { LayoutMode, PageRecord, PageViewport } from "./types";

/** PDF user-space point → top-left-origin page units for a scale-1
 *  viewport. Going through the viewport's own transform honours a
 *  CropBox origin that isn't (0,0) and any /Rotate. */
export function pdfPointToViewport(viewport: PageViewport, x: number, y: number): number[] {
  return viewport.convertToViewportPoint(x, y);
}

const SHELF_WIDTH_DEFAULT = 280;
const SHELF_WIDTH_MIN = 200;
const SHELF_WIDTH_MAX_FRAC = 0.6;
const SHELF_WIDTH_KEY = "zh-pdf-annot-shelf-width";

function storedShelfWidth(): number {
  try {
    const w = Number(localStorage.getItem(SHELF_WIDTH_KEY));
    return Number.isFinite(w) && w > 0 ? w : SHELF_WIDTH_DEFAULT;
  } catch {
    return SHELF_WIDTH_DEFAULT;
  }
}

export interface AnnotationViewer {
  getPages: () => PageRecord[];
  getEffectiveZoom: () => number;
  getLayoutMode: () => LayoutMode;
  goToPage: (n: number) => void;
  /** Folded view's navigation, when it is active. */
  scrollToFold?: (a: Annotation) => boolean;
  /** Send an annotation to the notes; absent hides the button. */
  onInsert?: (a: Annotation) => void;
}

export function createAnnotationLayer(
  scrollArea: HTMLElement,
  body: HTMLElement,
  viewer: AnnotationViewer,
) {
  let annotations: Annotation[] = [];
  let shelfOpen = false;
  let shelfFilter = "";
  let activeColor: string | null = null;

  const shelf = document.createElement("div");
  shelf.className = "pdf-annot-shelf";

  const shelfGrip = document.createElement("button");
  shelfGrip.type = "button";
  shelfGrip.className = "pdf-annot-shelf-grip";
  shelfGrip.textContent = "‹";
  shelfGrip.title = "Annotations";
  shelf.appendChild(shelfGrip);

  const shelfContent = document.createElement("div");
  shelfContent.className = "pdf-annot-shelf-content";
  const shelfHeader = document.createElement("div");
  shelfHeader.className = "pdf-annot-shelf-header";
  const shelfTitle = document.createElement("span");
  shelfTitle.textContent = "Annotations";
  shelfHeader.appendChild(shelfTitle);
  shelfContent.appendChild(shelfHeader);

  const shelfSearch = document.createElement("input");
  shelfSearch.type = "text";
  shelfSearch.className = "pdf-annot-shelf-search";
  shelfSearch.placeholder = "Filter...";
  shelfContent.appendChild(shelfSearch);

  const shelfColors = document.createElement("div");
  shelfColors.className = "pdf-annot-shelf-colors";
  shelfContent.appendChild(shelfColors);

  const shelfBody = document.createElement("div");
  shelfBody.className = "pdf-annot-shelf-body";
  shelfContent.appendChild(shelfBody);
  shelf.appendChild(shelfContent);

  // Left-edge resize strip, live only while the shelf is open.
  const shelfResize = document.createElement("div");
  shelfResize.className = "pdf-annot-shelf-resize";
  shelf.appendChild(shelfResize);
  body.appendChild(shelf);

  const clampWidth = (w: number) =>
    Math.max(
      SHELF_WIDTH_MIN,
      Math.min(
        Math.max(SHELF_WIDTH_MIN, (body.clientWidth || window.innerWidth) * SHELF_WIDTH_MAX_FRAC),
        w,
      ),
    );
  shelf.style.setProperty("--pdf-annot-shelf-width", `${clampWidth(storedShelfWidth())}px`);

  shelfResize.addEventListener("pointerdown", (e) => {
    if (!shelfOpen) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = shelf.getBoundingClientRect().width;
    let width = startW;
    shelf.classList.add("resizing");
    try {
      shelfResize.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    const onMove = (me: PointerEvent) => {
      // Right-anchored: a leftward drag widens it.
      width = clampWidth(startW - (me.clientX - startX));
      shelf.style.setProperty("--pdf-annot-shelf-width", `${width}px`);
    };
    const onUp = () => {
      shelf.classList.remove("resizing");
      shelfResize.removeEventListener("pointermove", onMove);
      shelfResize.removeEventListener("pointerup", onUp);
      shelfResize.removeEventListener("pointercancel", onUp);
      try {
        localStorage.setItem(SHELF_WIDTH_KEY, String(Math.round(width)));
      } catch {
        /* storage unavailable */
      }
    };
    shelfResize.addEventListener("pointermove", onMove);
    shelfResize.addEventListener("pointerup", onUp);
    shelfResize.addEventListener("pointercancel", onUp);
  });

  function toggleShelf(): void {
    shelfOpen = !shelfOpen;
    shelf.classList.toggle("open", shelfOpen);
    shelfGrip.textContent = shelfOpen ? "›" : "‹";
    if (shelfOpen) {
      shelf.style.setProperty("--pdf-annot-shelf-width", `${clampWidth(storedShelfWidth())}px`);
      rebuildShelfList();
    }
  }
  shelfGrip.addEventListener("click", toggleShelf);
  shelfSearch.addEventListener("input", () => {
    shelfFilter = shelfSearch.value.toLowerCase();
    rebuildShelfList();
  });

  function paintColorFilter(): void {
    shelfColors.innerHTML = "";
    const colors: string[] = [];
    for (const a of annotations) if (a.color && !colors.includes(a.color)) colors.push(a.color);
    if (activeColor && !colors.includes(activeColor)) activeColor = null;
    shelfColors.style.display = colors.length > 1 ? "" : "none";
    const swatch = (color: string | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        `pdf-annot-swatch${color ? "" : " pdf-annot-swatch-all"}` +
        (activeColor === color ? " active" : "");
      if (color) b.style.backgroundColor = color;
      b.title = color ? "Only this colour" : "All colours";
      b.addEventListener("click", () => {
        activeColor = color && activeColor !== color ? color : null;
        paintColorFilter();
        rebuildShelfList();
      });
      return b;
    };
    shelfColors.appendChild(swatch(null));
    for (const c of colors) shelfColors.appendChild(swatch(c));
  }

  function highlightMatches(text: string, query: string): Node {
    if (!query) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    const lower = text.toLowerCase();
    let last = 0;
    let idx = lower.indexOf(query, last);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = "pdf-annot-shelf-match";
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      last = idx + query.length;
      idx = lower.indexOf(query, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function emptyNote(text: string): void {
    const d = document.createElement("div");
    d.className = "pdf-annot-shelf-empty";
    d.textContent = text;
    shelfBody.appendChild(d);
  }

  function rebuildShelfList(): void {
    shelfBody.innerHTML = "";
    if (!annotations.length) return emptyNote("No annotations");
    const filtered = annotations.filter((a) => {
      if (activeColor && a.color !== activeColor) return false;
      if (!shelfFilter) return true;
      return (
        a.text.toLowerCase().includes(shelfFilter) ||
        a.comment.toLowerCase().includes(shelfFilter)
      );
    });
    if (!filtered.length) return emptyNote("No matches");
    for (const annot of filtered) {
      // A drawing or an image area has no words; list it by kind so it
      // can still be found and jumped to.
      const bare = !annot.text && !annot.comment;
      if (bare && annot.type !== "ink" && annot.type !== "image") continue;
      const row = document.createElement("div");
      row.className = "pdf-annot-shelf-row";
      row.style.borderLeftColor = annot.color || "#ffff00";
      row.addEventListener("click", () => scrollToAnnotation(annot));
      if (annot.text) {
        const el = document.createElement("div");
        el.className = "pdf-annot-shelf-text";
        el.appendChild(highlightMatches(annot.text, shelfFilter));
        row.appendChild(el);
      }
      if (bare) {
        const el = document.createElement("div");
        el.className = "pdf-annot-shelf-comment";
        el.textContent = annot.type === "ink" ? "Drawing" : "Image";
        row.appendChild(el);
      }
      if (annot.comment) {
        const el = document.createElement("div");
        el.className = "pdf-annot-shelf-comment";
        el.appendChild(highlightMatches(annot.comment, shelfFilter));
        row.appendChild(el);
      }
      const meta = document.createElement("div");
      meta.className = "pdf-annot-shelf-meta";
      if (annot.pageLabel) {
        const page = document.createElement("span");
        page.className = "pdf-annot-shelf-page";
        page.textContent = `p. ${annot.pageLabel}`;
        meta.appendChild(page);
      }
      if (viewer.onInsert && !bare) {
        const ins = document.createElement("button");
        ins.type = "button";
        ins.className = "pdf-annot-shelf-insert";
        ins.textContent = "Add to notes";
        ins.title = "Quote this in the notes, with a link back to the page";
        ins.addEventListener("click", (e) => {
          e.stopPropagation();
          viewer.onInsert?.(annot);
        });
        meta.appendChild(ins);
      }
      row.appendChild(meta);
      shelfBody.appendChild(row);
    }
  }

  function scrollToAnnotation(annot: Annotation): void {
    if (viewer.scrollToFold?.(annot)) return;
    const pages = viewer.getPages();
    const pos = annotationPosition(annot);
    if (!pos) {
      const n = parseInt(annot.pageLabel, 10);
      if (!isNaN(n)) viewer.goToPage(n);
      return;
    }
    const p = pages[pos.pageIndex];
    if (!p) return;
    const scale = viewer.getEffectiveZoom();
    // Top-left of the first rect, or the first point of a drawing.
    const rect = pos.rects?.[0];
    const path = pos.paths?.[0];
    const anchor = rect ? [rect[0], rect[3]] : path && path.length >= 2 ? [path[0], path[1]] : null;
    if (!anchor) {
      p.wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const [vx, vy] = pdfPointToViewport(p.viewport, anchor[0], anchor[1]);
    if (viewer.getLayoutMode() === "horizontal") {
      const left = p.wrapper.offsetLeft + vx * scale - scrollArea.clientWidth / 3;
      scrollArea.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    } else {
      const top = p.wrapper.offsetTop + vy * scale - scrollArea.clientHeight / 3;
      scrollArea.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  function setAnnotations(list: Annotation[]): void {
    annotations = list;
    shelf.classList.toggle("has-annotations", annotations.length > 0);
    paintColorFilter();
    if (shelfOpen) rebuildShelfList();
  }

  return {
    shelf,
    toggleShelf,
    setAnnotations,
    scrollToAnnotation,
    getAnnotations: () => annotations,
  };
}
