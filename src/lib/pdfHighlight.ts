// Finding a quoted passage on a rendered PDF page.
//
// The model quotes from LiteParse's extracted text; the page is drawn
// from pdf.js's text layer. The two disagree constantly in ways that
// don't matter to a reader — line wrapping, hyphens splitting words
// across lines, ligatures, curly quotes, runs of spaces from column
// layout — so matching is done on a normalized copy of the page text,
// with an index back to the real characters so the match can be turned
// into rectangles.
//
// A miss is expected and fine: the page still renders, just without a
// highlight. Wrong highlights would be worse than none, so nothing here
// guesses — it either finds the words or it doesn't.

/** One text run from pdf.js, with where it sits on the page. */
export interface TextRun {
  str: string;
  /** PDF user-space coordinates of the run's baseline origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** pdf.js sets this when the run ends a line. */
  eol: boolean;
}

export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  " ": " ", " ": " ", " ": " ", " ": " ",
  "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
  "…": "...",
};

/** Normalized text plus, for each normalized character, the index of
 *  the raw character it came from. */
interface Normalized {
  text: string;
  map: number[];
}

/** Lowercase, fold the typography apart, collapse whitespace, and heal
 *  words a line break split with a hyphen. Ligatures expand to more
 *  than one character, so every output character keeps a pointer back
 *  to the raw index it came from rather than assuming 1:1. */
function normalize(raw: string): Normalized {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    // A hyphen at a line break is word-splitting, not punctuation.
    if ((ch === "-" || ch === "­") && /\s/.test(raw[i + 1] ?? "")) {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      // Only heal when a letter follows; "see p. 3 - 4" keeps its dash.
      if (/\p{L}/u.test(raw[j] ?? "")) {
        i = j - 1;
        pendingSpace = false;
        continue;
      }
    }
    if (/\s/.test(ch)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(i);
      pendingSpace = false;
    }
    const folded = (FOLD[ch] ?? ch).toLowerCase();
    for (const out of folded) {
      text += out;
      map.push(i);
    }
  }
  return { text, map };
}

/** Where in the page's raw text a quotation sits, or null. */
function findRawRange(
  runs: TextRun[],
  quote: string,
): { start: number; end: number } | null {
  const pageRaw = runs.map((r) => r.str + (r.eol ? "\n" : "")).join("");
  const page = normalize(pageRaw);
  const needle = normalize(quote).text.trim();
  if (needle.length < 8) return null;

  const exact = page.text.indexOf(needle);
  // Extraction can drop or add a word at either end (a running head
  // swept into the paragraph, a footnote marker), so a quote that
  // doesn't match whole gets one more try on its longest matching run.
  const hit =
    exact >= 0
      ? { at: exact, len: needle.length }
      : looseFind(page.text, needle);
  if (!hit) return null;
  return {
    start: page.map[hit.at],
    end: page.map[Math.min(hit.at + hit.len - 1, page.map.length - 1)] + 1,
  };
}

/** Give up on the tails of the quote — trimming from the end first,
 *  then from the start — until what's left is on the page. Bounded to
 *  keep a wildly wrong quote from matching some short fragment. */
function looseFind(
  hay: string,
  needle: string,
): { at: number; len: number } | null {
  const floor = Math.max(24, Math.floor(needle.length * 0.6));
  for (let len = needle.length - 1; len >= floor; len -= 4) {
    const head = hay.indexOf(needle.slice(0, len));
    if (head >= 0) return { at: head, len };
    const tail = hay.indexOf(needle.slice(needle.length - len));
    if (tail >= 0) return { at: tail, len };
  }
  return null;
}

/** Rectangles covering a quotation, in PDF user space. One per text run
 *  the match touches; the first and last are trimmed to the characters
 *  actually inside the match, which assumes even character widths — an
 *  approximation a highlight can carry. */
export function locateQuote(runs: TextRun[], quote: string): HighlightRect[] {
  if (!quote.trim()) return [];
  const range = findRawRange(runs, quote);
  if (!range) return [];

  const rects: HighlightRect[] = [];
  let cursor = 0;
  for (const run of runs) {
    const start = cursor;
    const end = start + run.str.length;
    cursor = end + (run.eol ? 1 : 0);
    if (end <= range.start || start >= range.end) continue;
    if (run.str.length === 0 || run.width <= 0) continue;

    const from = Math.max(0, range.start - start);
    const to = Math.min(run.str.length, range.end - start);
    const per = run.width / run.str.length;
    const x = run.x + from * per;
    const w = (to - from) * per;
    if (w <= 0) continue;
    // Text sits on its baseline; the box wants a little air under it.
    const h = run.height > 0 ? run.height : 10;
    rects.push({ x, y: run.y - h * 0.2, w, h: h * 1.2 });
  }
  return rects;
}
