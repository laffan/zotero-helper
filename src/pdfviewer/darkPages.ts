// Dark pages: the PDF drawn white on black, for reading in the dark
// theme. The bottom bar's light bulb steps through three settings —
// pages as printed, dark pages, and night vision (nightVision.ts: dark
// pages with the whole reader pane in red alone) — and round again. It
// is offered only while the app itself is dark, and has no effect
// otherwise (pdfviewer.css gates both on the theme, as tokens.css does),
// so a switch to the light theme brings the pages back as printed.
//
// It is a CSS filter over each page's raster and ink — inverted, then
// turned half way round the colour wheel so hues keep roughly their own
// colour — rather than pdf.js's `pageColors`, which would mean drawing
// every page again on each switch and maps images to two tones. The
// text layer, selections, search hits and the app's own marks are left
// alone. Off to begin with; the choice is this device's (`zh-pdf-dark`:
// "0", "1" dark, "2" night vision — "1" is what the bulb stored when it
// was on/off only).
//
// `darkPagesCopy` draws the same filter into a copy of a canvas, for an
// image kept apart from the pages: a clip on the notepad
// (notepad/clip.ts), shown so once it is pinned in the dark theme.
import { setNightVision } from "./nightVision";

const KEY = "zh-pdf-dark";
/** pdfviewer-dark.css's `--pdf-dark-filter`. */
const DARK_FILTER = "invert(1) hue-rotate(180deg)";

/** The bulb's three settings, in the order a press steps through them. */
export type PageTone = "normal" | "dark" | "night";
const TONES: PageTone[] = ["normal", "dark", "night"];
const STORED: Record<PageTone, string> = { normal: "0", dark: "1", night: "2" };
/** The bulb's tooltip: the setting it is on, and what a press does. */
const TIPS: Record<PageTone, string> = {
  normal: "Pages as printed — press for dark pages",
  dark: "Dark pages, white on black — press for night vision",
  night: "Night vision: the reader in red only, no blue light — press for pages as printed",
};

function stored(): PageTone {
  try {
    const v = localStorage.getItem(KEY);
    return TONES.find((t) => STORED[t] === v) ?? "normal";
  } catch {
    return "normal";
  }
}

/** `pages`: the element the pages are under; `button`: the bar's bulb;
 *  `nightHost`: what night vision covers (the reader pane). Returns the
 *  undo, which takes night vision's layers down. */
export function attachDarkPages(pages: HTMLElement, button: HTMLElement, nightHost: HTMLElement): () => void {
  let tone: PageTone = "normal";
  const set = (next: PageTone) => {
    tone = next;
    // Night vision keeps the pages white on black, so they come out red
    // on black rather than as a red sheet.
    pages.classList.toggle("pdf-dark-pages", tone !== "normal");
    button.classList.toggle("active", tone !== "normal");
    button.classList.toggle("night", tone === "night");
    button.title = TIPS[tone];
    setNightVision(nightHost, tone === "night");
    try {
      localStorage.setItem(KEY, STORED[tone]);
    } catch {
      /* storage unavailable: the choice lasts the session */
    }
  };
  set(stored());
  button.addEventListener("click", () => set(TONES[(TONES.indexOf(tone) + 1) % TONES.length]));
  return () => setNightVision(nightHost, false);
}

/** CSS's hue-rotate(180deg) as a matrix (Filter Effects), for a canvas
 *  that can't take `filter`: cos −1, sin 0. */
const HUE_180 = [-0.574, 1.43, 0.144, 0.426, 0.43, 0.144, 0.426, 1.43, -0.856];

/** A copy of `src` as dark pages draw it: inverted, then turned half way
 *  round the colour wheel. Through the context's `filter` where there is
 *  one, so it is the CSS filter itself; else pixel by pixel. */
export function darkPagesCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  if ("filter" in CanvasRenderingContext2D.prototype) {
    ctx.filter = DARK_FILTER;
    ctx.drawImage(src, 0, 0);
    return out;
  }
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const m = HUE_180;
  for (let i = 0; i < d.length; i += 4) {
    const r = 255 - d[i];
    const g = 255 - d[i + 1];
    const b = 255 - d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
