// The Highlight Map's columns, wrapped to the canvas's height: a
// chapter's row is never taller than the canvas (at 100%), so the
// chapters go down the map and what is in each goes across it. A column
// (one of the chapter's sections, layout.ts) is a flow of cards and
// small headings in reading order; here it is laid out as stacks side by
// side under the column's heading, the first filled to the height there
// is room for, then the next — so a long section runs on into a second
// column, a third, to its right.
//
// The items are placed here, absolutely within their flow, rather than
// put into stacks by React: moved into the next stack, a card or heading
// would otherwise be mounted afresh and lose what it was doing — a
// section being renamed, which itself makes its heading taller.
//
// When: after each render of the map (HighlightMap.tsx), when the
// canvas's height changes, and when any item's does (a card picked and
// shown in full, a heading renamed, the font size) — a ResizeObserver
// on each. The height is the canvas's, not the zoomed view's, so a zoom
// moves nothing about: at 100% a chapter fits the canvas; zoomed out,
// several do.

/** Room kept above and below a chapter at 100% (view.ts's MARGIN, twice). */
const ROOM = 48;
/** The least a stack is given, however short the canvas, px. */
const MIN_STACK = 200;
/** Between the stacks of one column, px (columns: .hlmap-columns' gap). */
const STACK_GAP = 14;

/** Where each stack begins, given the items' heights (`h`) and which are
 *  headings: each filled to `max` in turn. An item taller than `max` has
 *  a stack to itself, and a heading isn't left at a stack's foot — it
 *  goes over with what follows it. */
export function stackStarts(h: number[], heading: boolean[], max: number): number[] {
  const starts = [0];
  let used = 0;
  for (let i = 0; i < h.length; i++) {
    const start = starts[starts.length - 1];
    if (i > start && used + h[i] > max) {
      let at = i;
      while (at - 1 > start && heading[at - 1]) at--;
      starts.push(at);
      used = 0;
      for (let k = at; k < i; k++) used += h[k];
    }
    used += h[i];
  }
  return starts;
}

/** A style property, written only when it changes. */
function put(el: HTMLElement, prop: "left" | "top" | "width" | "height", value: string): void {
  if (el.style[prop] !== value) el.style[prop] = value;
}

interface Flow {
  el: HTMLElement;
  items: HTMLElement[];
  h: number[];
  /** An item's width, the stacks' (CSS sets it). */
  w: number;
  max: number;
}

export function createMapWrap(host: HTMLElement, layer: HTMLElement) {
  const watched = new Set<HTMLElement>();
  /** The canvas's height at the last layout. */
  let laidH = 0;
  // An item's size, or the canvas's height: only its width changing (a
  // pane's edge dragged) leaves the stacks as they are.
  const resize = new ResizeObserver((entries) => {
    if (entries.some((en) => en.target !== host) || host.clientHeight !== laidH) relayout();
  });
  resize.observe(host);

  function relayout(): void {
    const H = host.clientHeight;
    // Folded away: nothing to fit, and the last layout stands.
    if (!H) return;
    laidH = H;
    for (const el of watched) {
      if (!el.isConnected) {
        resize.unobserve(el);
        watched.delete(el);
      }
    }
    // Everything read before anything is written, so the layout is
    // worked out once: an item's height doesn't depend on its place,
    // nor a flow's top on the flows' sizes (the columns align at the top).
    const flows: Flow[] = [];
    for (const el of layer.querySelectorAll<HTMLElement>(".hlmap-flow")) {
      const items = [...el.children].filter((c): c is HTMLElement => c.classList.contains("hlmap-item"));
      if (!items.length) continue;
      for (const it of items) {
        if (!watched.has(it)) {
          watched.add(it);
          resize.observe(it);
        }
      }
      // The flow's top within its chapter (.hlmap-row is the offset
      // parent), from the chapter's first line: its heading and the
      // column's are what the stacks share the height with.
      const row = el.closest<HTMLElement>(".hlmap-row");
      const first = row?.firstElementChild as HTMLElement | null;
      const top = el.offsetTop - (first?.offsetTop ?? 0);
      const h = items.map((it) => it.offsetHeight);
      flows.push({ el, items, h, w: items[0].offsetWidth, max: Math.max(MIN_STACK, H - ROOM - top) });
    }
    for (const { el, items, h, w, max } of flows) {
      const heading = items.map((it) => it.classList.contains("hlmap-item-head"));
      const starts = stackStarts(h, heading, max);
      let tallest = 0;
      starts.forEach((start, c) => {
        const end = starts[c + 1] ?? items.length;
        let y = 0;
        for (let i = start; i < end; i++) {
          put(items[i], "left", `${c * (w + STACK_GAP)}px`);
          put(items[i], "top", `${y}px`);
          y += h[i];
        }
        tallest = Math.max(tallest, y);
      });
      put(el, "width", `${starts.length * w + (starts.length - 1) * STACK_GAP}px`);
      put(el, "height", `${tallest}px`);
    }
  }

  return {
    relayout,
    destroy(): void {
      resize.disconnect();
      watched.clear();
    },
  };
}

export type MapWrapControl = ReturnType<typeof createMapWrap>;
