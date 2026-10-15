// The paged view ("Paged" on the toolbar, against "Continuous"): one
// set of pages at a time — one, two or three, as the fit buttons say —
// fitted whole and centred, and a swipe moves exactly one set: left/
// right when the pages run side by side, up/down when they run top to
// bottom (in rows of the set's size).
//
// The pages stay the one strip the continuous view uses, so the
// renderer, search, links and annotations work unchanged; CSS scroll
// snapping does the paging (pdfviewer.css, `.pdf-paged`): each set's
// first page is a snap point, and scroll-padding centres the set on
// it. A swipe, a trackpad flick, the arrow keys and a scrollbar drag
// all come to rest on a set, and `scroll-snap-stop` keeps a hard flick
// from skipping past the next one. The space between sets is just wide
// enough to keep the neighbours out of sight, so a swipe travels about
// one view, and the first and last set get as much again outside them.
//
// A set is fitted to all of the view but a hair: the reading is the
// point, so there is no frame of margin around it, and the pages of a
// set sit a few pixels apart.

/** Pages side by side within a set (pdfviewer.css matches it). */
export const SET_GAP = 4;
/** The room left around a set, both ways together (CSS px). */
export const PAGED_PAD = 8;

/** The scale at which a set of `n` pages fits the view, both ways. */
export function pagedFitZoom(
  area: HTMLElement,
  page: { width: number; height: number },
  pad: number,
  n: number,
): number {
  const across = (area.clientWidth - pad - (n - 1) * SET_GAP - 4) / (n * page.width);
  return Math.min(across, (area.clientHeight - pad) / page.height);
}

/** Size the spacing to the view and to `setSize`, a set's CSS size
 *  along the scroll (or clear it, `on` false). */
export function setPagedGap(area: HTMLElement, on: boolean, horiz: boolean, setSize: number): void {
  if (!on) {
    area.style.removeProperty("--pdf-paged-pad");
    area.style.removeProperty("--pdf-paged-gap");
    return;
  }
  const view = horiz ? area.clientWidth : area.clientHeight;
  const pad = Math.max(0, Math.floor((view - setSize) / 2));
  area.style.setProperty("--pdf-paged-pad", `${pad}px`);
  area.style.setProperty("--pdf-paged-gap", `${pad + 24}px`);
}

/** Wheel and trackpad in the fixed view: one gesture, one set.
 *  Left to snapping, a wheel notch is too short a scroll to reach the
 *  next set and settles back on the same one; a trackpad swipe's
 *  momentum keeps sending events, so a set is turned only once the
 *  wheel has been quiet for a moment. Pinch (ctrl + wheel) is left
 *  alone. */
export function attachPagedWheel(
  area: HTMLElement,
  isPaged: () => boolean,
  step: (dir: 1 | -1) => void,
): void {
  let inGesture = false;
  let quiet = 0;
  area.addEventListener(
    "wheel",
    (e) => {
      if (!isPaged() || e.ctrlKey) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      clearTimeout(quiet);
      quiet = window.setTimeout(() => (inGesture = false), 200);
      if (inGesture || Math.abs(d) < 4) return;
      inGesture = true;
      step(d > 0 ? 1 : -1);
    },
    { passive: false },
  );
}
