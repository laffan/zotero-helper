// The viewer's keyboard: ⌘+ / ⌘- / ⌘0 (Ctrl elsewhere) zoom while it
// is mounted. A handler that already spent the keystroke
// (defaultPrevented) wins. The page-turning keys are the app's
// rebindable shortcuts (lib/shortcuts/, through commands.ts), which
// use the stepper here: steps count from the page last asked for, not
// the one a smooth scroll has reached so far — the wheel in the fixed
// view uses the same stepper, and there a step is a whole set of pages.

export interface ViewerKeyActions {
  stepZoom: (dir: 1 | -1) => void;
  /** ⌘0: back to the default layout. */
  resetZoom: () => void;
  pageCount: () => number;
  /** Pages to a step: the set's size in the fixed view, else one. */
  stepSize: () => number;
  currentPage: () => number;
  goToPage: (n: number) => void;
}

export function attachViewerKeys(act: ViewerKeyActions) {
  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const zoom = e.key === "=" || e.key === "+" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
    if (zoom === null) return;
    e.preventDefault();
    if (zoom) act.stepZoom(zoom);
    else act.resetZoom();
  }
  window.addEventListener("keydown", onKeydown);

  let pageTarget: { page: number; at: number } | null = null;
  function stepPage(dir: 1 | -1): void {
    const count = act.pageCount();
    if (!count) return;
    const recent = pageTarget && performance.now() - pageTarget.at < 700;
    const from = recent ? pageTarget!.page : act.currentPage();
    const page = Math.max(1, Math.min(count, from + dir * act.stepSize()));
    pageTarget = { page, at: performance.now() };
    act.goToPage(page);
  }
  return {
    stepPage,
    detach: () => window.removeEventListener("keydown", onKeydown),
  };
}
