// Night vision: the reader drawn in red alone — no blue light, and no
// green — for reading in the dark without losing dark adaptation (the
// rods that see at night are nearly blind to deep red). The third
// setting of the bottom bar's light bulb, after dark pages
// (darkPages.ts), whose white-on-black pages it keeps: they come out
// red on black.
//
// It covers a portion of the app, the reader pane's box (ReaderPane
// gives the viewer that element as `nightVisionHost`): the pages, the
// bar, the outline and reading mode's notepad — the whole screen in
// reading mode. The library, the notes panel and modals keep their
// colours, and so does anything of the pane's drawn outside its box (the
// explanation box floats at the window's bottom right, which is over
// the notes panel outside reading mode).
//
// Two click-through layers, the pane's last children, over everything
// in it (pdfviewer-night.css):
//   1. `backdrop-filter: grayscale(1)` — what is under it reduced to
//      its luminance;
//   2. pure red with `mix-blend-mode: multiply` — that grey times
//      (1, 0, 0): luminance in the red channel, green and blue zero.
// Filter functions and a blend mode only: WebKit takes an SVG `url()`
// filter off its accelerated path (unreliable over composited layers)
// and doesn't take one in `backdrop-filter` at all. Whatever the grey
// layer misses is still multiplied by the red one, so nothing under it
// keeps any blue. The pane is isolated while they are up, so their
// z-index orders them against the pane's contents only.
//
// Like dark pages, it acts only in the dark theme: the layers read a
// variable only the dark theme defines, so in the light theme the
// pages are as printed whatever the bulb was left on.
const LAYER = "reader-night-layer";
const HOST = "reader-night-vision";

/** Put the layers up on `host` (once), or take them down. */
export function setNightVision(host: HTMLElement, on: boolean): void {
  const layers = Array.from(host.querySelectorAll<HTMLElement>(`:scope > .${LAYER}`));
  host.classList.toggle(HOST, on);
  if (!on) {
    for (const l of layers) l.remove();
    return;
  }
  if (layers.length === 2) {
    // Keep them last, over anything the pane gained since.
    host.append(...layers);
    return;
  }
  for (const l of layers) l.remove();
  const layer = (kind: string) => {
    const el = document.createElement("div");
    el.className = `${LAYER} ${LAYER}-${kind}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  };
  host.append(layer("grey"), layer("red"));
}
