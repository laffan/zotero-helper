// Dragging a text selection in the pages back as well as forward.
//
// A text layer is absolutely placed spans with gaps between them, and
// WebKit (the iPad and the macOS app alike) resolves a pointer over a
// gap to the closest place in the layer as a whole — usually its end.
// So once a drag had passed a line, pulling back over the space between
// lines didn't shrink the selection: the browser kept extending it to
// the end of the page. pdf.js's own viewer avoids this with an empty
// `.endOfContent` element that covers the layer while a selection is
// being made (`.selecting`, pdfviewer.css) and is moved, on every
// selectionchange, to just beside the end of the selection that is
// moving — so a pointer over a gap lands there, and the selection ends
// where the pointer last was over text. This is that, ported from
// pdf.js's TextLayerBuilder (web/text_layer_builder.js), which the
// viewer doesn't otherwise use; Firefox and Chromium 148+ don't need it
// and are left alone, as pdf.js leaves them.

const layers = new Map<HTMLElement, HTMLElement>();
let listening = false;
let pointerDown = false;
let prevRange: Range | null = null;
let native: boolean | undefined;

function reset(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  end.style.userSelect = "";
  layer.classList.remove("selecting");
}

/** Every layer still on the page (evicted pages' layers are dropped). */
function live(): [HTMLElement, HTMLElement][] {
  for (const layer of layers.keys()) if (!layer.isConnected) layers.delete(layer);
  return [...layers];
}

const resetAll = () => {
  for (const [layer, end] of live()) reset(end, layer);
};

/** Does this browser resolve gaps sensibly by itself? */
function selectsNatively(sample: HTMLElement): boolean {
  if (native !== undefined) return native;
  native = getComputedStyle(sample).getPropertyValue("-moz-user-select") === "none";
  if (!native) {
    const v = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
    native = Boolean(v && parseInt(v, 10) >= 148);
  }
  return native;
}

function onSelectionChange(): void {
  const selection = document.getSelection();
  const all = live();
  if (!selection || selection.rangeCount === 0) {
    prevRange = null;
    return resetAll();
  }
  const range = selection.getRangeAt(0);
  for (const [layer, end] of all) {
    if (range.intersectsNode(layer)) layer.classList.add("selecting");
    else reset(end, layer);
  }
  if (!all.length || selectsNatively(all[0][0])) return;

  // Which end is moving: the start when the end stayed put.
  const modifyStart = Boolean(
    prevRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0),
  );
  let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode!;
  if (!modifyStart && range.endOffset === 0) {
    // The end sits before the first character of a span: anchor on the
    // last span with text before it.
    do {
      while (!anchor.previousSibling) anchor = anchor.parentNode!;
      anchor = anchor.previousSibling;
    } while (!anchor.childNodes.length);
  }
  const layer = anchor.parentElement?.closest<HTMLElement>(".textLayer");
  const end = layer ? layers.get(layer) : undefined;
  if (layer && end && anchor.parentElement) {
    end.style.width = layer.style.width;
    end.style.height = layer.style.height;
    end.style.userSelect = "text";
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("pointerdown", () => (pointerDown = true));
  document.addEventListener("pointerup", () => {
    pointerDown = false;
    resetAll();
  });
  window.addEventListener("blur", () => {
    pointerDown = false;
    resetAll();
  });
  document.addEventListener("keyup", () => !pointerDown && resetAll());
  document.addEventListener("selectionchange", onSelectionChange);
}

/** Give a freshly rendered text layer its `.endOfContent`. */
export function enableTextSelection(layer: HTMLElement): void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  layer.addEventListener("mousedown", () => layer.classList.add("selecting"));
  layers.set(layer, end);
  listen();
}
