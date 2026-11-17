// Night vision: the whole app drawn in red alone — no blue light, and
// no green — for working in the dark without losing dark adaptation
// (the rods that see at night are nearly blind to deep red). The header
// button beside Settings turns it on and off (Toolbar.tsx); the choice
// is this device's, kept with the other UI prefs in the store
// (`nightVision`), so it lasts until it is turned off. It lies over
// whatever is on screen — either theme, dark pages or not, reading mode,
// Settings and modals.
//
// Two click-through layers on <body>, over everything else
// (nightvision.css):
//   1. `backdrop-filter: grayscale(1)` — what is under it reduced to
//      its luminance;
//   2. pure red with `mix-blend-mode: multiply` — that grey times
//      (1, 0, 0): luminance in the red channel, green and blue zero.
// Filter functions and a blend mode only: an SVG `url()` filter would do
// it in one step, but WebKit renders those off its accelerated path
// (unreliable over composited layers — the PDF canvases, video) and
// doesn't take them in `backdrop-filter` at all. Whatever the grey layer
// misses is still multiplied by the red one, so nothing keeps any blue.
// Children of <body>, not of one host, because a host would be its own
// stacking context and both layers would sample its empty backdrop.
import { useStore } from "./store";

const GREY = "night-vision-grey";
const RED = "night-vision-red";

function apply(on: boolean): void {
  const have = document.getElementById(GREY);
  document.documentElement.classList.toggle("night-vision", on);
  if (!on) {
    have?.remove();
    document.getElementById(RED)?.remove();
    return;
  }
  if (have) return;
  const layer = (id: string) => {
    const el = document.createElement("div");
    el.id = id;
    el.className = "night-vision-layer";
    el.setAttribute("aria-hidden", "true");
    return el;
  };
  document.body.append(layer(GREY), layer(RED));
}

/** Apply the stored choice before the first render (so the app never
 *  shows in colour first), and follow it from then on. */
export function initNightVision(): void {
  apply(useStore.getState().nightVision);
  useStore.subscribe((now, prev) => {
    if (now.nightVision !== prev.nightVision) apply(now.nightVision);
  });
}
