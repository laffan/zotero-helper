// Single-page view: one page at a time, fitted whole and centred, and a
// swipe moves exactly one page — left/right when the pages run side by
// side, up/down when they run top to bottom.
//
// The pages stay the one strip the continuous view uses, so the
// renderer, search, links and annotations work unchanged; CSS scroll
// snapping does the paging (pdfviewer.css, `.pdf-single`). A swipe, a
// trackpad flick, the arrow keys and a scrollbar drag all come to rest
// on a page, and `scroll-snap-stop` keeps a hard flick from skipping
// past the next one. The gap between pages is just wide enough to keep
// the neighbours out of sight, so a swipe travels about one view, and
// the first and last page get as much again outside them, so they can
// centre too.

/** The scale at which the whole page fits the view, both ways. */
export function singleFitZoom(area: HTMLElement, page: { width: number; height: number }, pad: number): number {
  return Math.min((area.clientWidth - pad) / page.width, (area.clientHeight - pad) / page.height);
}

/** Size the gap between pages to the view and to `pageSize`, a page's
 *  CSS size along the scroll (or clear it, `on` false). */
export function setSingleGap(area: HTMLElement, on: boolean, horiz: boolean, pageSize: number): void {
  if (!on) {
    area.style.removeProperty("--pdf-single-gap");
    return;
  }
  const view = horiz ? area.clientWidth : area.clientHeight;
  area.style.setProperty("--pdf-single-gap", `${Math.max(24, Math.ceil((view - pageSize) / 2) + 24)}px`);
}

/** Wheel and trackpad in the single-page view: one gesture, one page.
 *  Left to snapping, a wheel notch is too short a scroll to reach the
 *  next page and settles back on the same one; a trackpad swipe's
 *  momentum keeps sending events, so a page is turned only once the
 *  wheel has been quiet for a moment. Pinch (ctrl + wheel) is left
 *  alone. */
export function attachSingleWheel(
  area: HTMLElement,
  isSingle: () => boolean,
  step: (dir: 1 | -1) => void,
): void {
  let inGesture = false;
  let quiet = 0;
  area.addEventListener(
    "wheel",
    (e) => {
      if (!isSingle() || e.ctrlKey) return;
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
