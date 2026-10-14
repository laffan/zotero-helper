// The viewer's keyboard commands (bound in lib/shortcuts/). Each mode
// command presses its toolbar button, so the keys and the bar can never
// disagree; paging steps through the pages — or, in the folded view,
// from fold to fold — and "expandFold" opens the fold under the
// pointer (the one at the centre of the view when the pointer isn't
// over one).
import type { PdfToolbar } from "./toolbar";

export type ViewerCommand =
  | "horizontal" | "vertical" | "fit1" | "fit2" | "fit3" | "fixed" | "continuous"
  | "folded" | "foldFilters" | "expandFold" | "thumbnails" | "next" | "prev";

interface CommandEnv {
  tb: PdfToolbar;
  scrollArea: HTMLElement;
  isFolded: () => boolean;
  stepPage: (dir: 1 | -1) => void;
}

const shown = (el: HTMLElement) => el.style.display !== "none";

export function createViewerCommands(env: CommandEnv) {
  const { tb, scrollArea } = env;
  let pointer: { x: number; y: number } | null = null;
  scrollArea.addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  scrollArea.addEventListener("pointerleave", () => (pointer = null));

  const folds = () => Array.from(scrollArea.querySelectorAll<HTMLElement>(".pdf-fold-wrapper"));

  /** The fold across the middle of the view, else the nearest. */
  function centreFold(list: HTMLElement[]): number {
    const mid = scrollArea.scrollTop + scrollArea.clientHeight / 2;
    let best = -1;
    let bestD = Infinity;
    list.forEach((f, i) => {
      const d = f.offsetTop > mid ? f.offsetTop - mid : Math.max(0, mid - (f.offsetTop + f.offsetHeight));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // Like page steps, fold steps count from the fold last asked for
  // while a smooth scroll is still on its way there.
  let foldTarget: { idx: number; at: number } | null = null;
  function stepFold(dir: 1 | -1): void {
    const list = folds();
    if (!list.length) return;
    const recent = foldTarget && performance.now() - foldTarget.at < 700;
    const from = recent ? foldTarget!.idx : centreFold(list);
    const idx = Math.max(0, Math.min(list.length - 1, from + dir));
    foldTarget = { idx, at: performance.now() };
    const f = list[idx];
    // A strip is centred; a fold opened to its page starts at the top.
    const tall = f.offsetHeight > scrollArea.clientHeight * 0.8;
    const top = tall ? f.offsetTop - 12 : f.offsetTop + f.offsetHeight / 2 - scrollArea.clientHeight / 2;
    scrollArea.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function expandFold(): void {
    if (!env.isFolded()) return;
    const under = pointer ? document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>(".pdf-fold-wrapper") : null;
    const list = folds();
    const fold = under ?? list[centreFold(list)];
    fold?.querySelector<HTMLButtonElement>(".pdf-fold-toggle")?.click();
  }

  /** The fit buttons show only where they apply (vertical scroll, or
   *  the fixed view); from horizontal scroll, pressing one goes vertical. */
  function fit(btn: HTMLButtonElement): void {
    if (!shown(tb.fitToggleWrap)) tb.scrollVBtn.click();
    btn.click();
  }

  return (cmd: ViewerCommand): void => {
    switch (cmd) {
      case "horizontal": return tb.scrollHBtn.click();
      case "vertical": return tb.scrollVBtn.click();
      case "fit1": return fit(tb.fitOneBtn);
      case "fit2": return fit(tb.fitTwoBtn);
      case "fit3": return fit(tb.fitThreeBtn);
      case "fixed": return tb.fixedBtn.click();
      case "continuous": return tb.continuousBtn.click();
      case "folded": return tb.foldBtn.click();
      case "foldFilters":
        if (!env.isFolded()) tb.foldBtn.click();
        return tb.foldFilterBtn.click();
      case "expandFold": return expandFold();
      case "thumbnails": return tb.thumbnailBtn.click();
      case "next":
      case "prev":
        return env.isFolded() ? stepFold(cmd === "next" ? 1 : -1) : env.stepPage(cmd === "next" ? 1 : -1);
    }
  };
}
