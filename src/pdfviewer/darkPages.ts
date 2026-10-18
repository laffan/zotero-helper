// Dark pages: the PDF drawn white on black, for reading in the dark
// theme. The bottom bar's light bulb turns it on and off; it is offered
// only while the app itself is dark, and has no effect otherwise
// (pdfviewer.css gates both on the theme, as tokens.css does), so a
// switch to the light theme brings the pages back as printed.
//
// It is a CSS filter over each page's raster and ink — inverted, then
// turned half way round the colour wheel so hues keep roughly their own
// colour — rather than pdf.js's `pageColors`, which would mean drawing
// every page again on each switch and maps images to two tones. The
// text layer, selections, search hits and the app's own marks are left
// alone. Off to begin with; the choice is this device's.
const KEY = "zh-pdf-dark";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** `pages`: the element the pages are under; `button`: the bar's bulb. */
export function attachDarkPages(pages: HTMLElement, button: HTMLElement): void {
  const set = (on: boolean) => {
    pages.classList.toggle("pdf-dark-pages", on);
    button.classList.toggle("active", on);
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* storage unavailable: the choice lasts the session */
    }
  };
  set(stored());
  button.addEventListener("click", () => set(!pages.classList.contains("pdf-dark-pages")));
}
