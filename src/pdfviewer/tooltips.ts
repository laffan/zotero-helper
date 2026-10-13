// Tooltips for the viewer's bottom toolbar, whose buttons are mostly
// bare glyphs. A `title` tooltip never shows on iPad: a finger has no
// hover, and iPadOS's web views don't draw them for a trackpad pointer
// either. So the titles are drawn here — after a moment's hover with a
// mouse, trackpad or pencil, and on a press-and-hold with a finger. A
// hold that brought up its tooltip doesn't count as a tap, so asking
// what a button does never does it.

const HOVER_MS = 450;
const HOLD_MS = 450;
const HOLD_SHOWN_MS = 1600;

export function attachTooltips(bar: HTMLElement, host: HTMLElement): () => void {
  const tip = document.createElement("div");
  tip.className = "pdf-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.style.display = "none";
  host.appendChild(tip);

  let showTimer = 0;
  let hideTimer = 0;
  let shownFor: HTMLElement | null = null;
  let held: { el: HTMLElement; x: number; y: number } | null = null;
  let swallowClick = false;

  /** The element's tooltip text. Its `title` moves to `data-tip` the
   *  first time it is met (and after any later change), so the
   *  browser's own tooltip doesn't show as well where it would. */
  function textOf(el: HTMLElement): string {
    const t = el.getAttribute("title");
    if (t) {
      el.dataset.tip = t;
      el.removeAttribute("title");
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", t);
    }
    return el.dataset.tip ?? "";
  }
  const targetOf = (e: Event) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>("[title], [data-tip]");
    return el && bar.contains(el) ? el : null;
  };

  function show(el: HTMLElement): void {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    shownFor = el;
    tip.textContent = text;
    tip.style.display = "";
    const h = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = r.left - h.left + r.width / 2 - tip.offsetWidth / 2;
    tip.style.left = `${Math.max(6, Math.min(left, h.width - tip.offsetWidth - 6))}px`;
    tip.style.top = `${r.top - h.top - tip.offsetHeight - 6}px`;
  }
  function hide(): void {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    shownFor = null;
    tip.style.display = "none";
  }

  for (const el of Array.from(bar.querySelectorAll<HTMLElement>("[title]"))) textOf(el);

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = targetOf(e);
    if (el === shownFor) return;
    hide();
    if (el) showTimer = window.setTimeout(() => show(el), HOVER_MS);
  };
  const onOut = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = targetOf(e);
    if (el && !el.contains(e.relatedTarget as Node | null)) hide();
  };
  const onDown = (e: PointerEvent) => {
    hide();
    held = null;
    if (e.pointerType !== "touch") return;
    const el = targetOf(e);
    if (!el) return;
    held = { el, x: e.clientX, y: e.clientY };
    showTimer = window.setTimeout(() => {
      show(el);
      swallowClick = true;
      hideTimer = window.setTimeout(hide, HOLD_SHOWN_MS);
    }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 10) {
      held = null;
      clearTimeout(showTimer);
    }
  };
  const onUp = () => {
    held = null;
    if (!shownFor) clearTimeout(showTimer);
  };
  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return hide();
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  // A long press would otherwise bring up the system's own menu.
  const onContextMenu = (e: Event) => {
    if (targetOf(e)) e.preventDefault();
  };

  bar.addEventListener("pointerover", onOver);
  bar.addEventListener("pointerout", onOut);
  bar.addEventListener("pointerdown", onDown);
  bar.addEventListener("pointermove", onMove);
  bar.addEventListener("pointerup", onUp);
  bar.addEventListener("pointercancel", onUp);
  bar.addEventListener("click", onClick, true);
  bar.addEventListener("contextmenu", onContextMenu);

  return () => {
    hide();
    tip.remove();
  };
}
