// Finding a quoted passage on a rendered PDF page.
//
// The model quotes from LiteParse's extracted text; the page is drawn
// from pdf.js's text layer. Those two disagree about almost everything
// *between* the words — line wrapping, hyphens splitting a word across
// lines, ligatures, curly quotes, the runs of spaces column layout
// leaves behind, and pdf.js's habit of breaking a run mid-word at a
// kerning pair with no space to show for it. Comparing characters means
// losing to all of that.
//
// So nothing here compares characters. Both sides are reduced to a list
// of words, the quote is anchored by its first and last pair of words,
// and where several spans match, the interior words decide which one was
// meant. Whitespace never enters into it.
//
// A miss is expected and fine: the page still renders, just without a
// highlight. A wrong highlight would be worse than none, so a candidate
// has to earn its interior words before it is accepted.

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

/** A word, and the raw character range it came from. */
interface Word {
  text: string;
  start: number;
  end: number;
}

const WORDY = /[\p{L}\p{N}]/u;

/** Reduce a character to what a comparison should see. Decomposing
 *  splits ligatures and accents apart; dropping the combining marks
 *  leaves plain letters on both sides. Punctuation needs no folding —
 *  it never survives tokenizing, so curly quotes and em dashes are
 *  simply not a problem here. */
function fold(ch: string): string {
  return ch
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Split text into comparable words. A hyphen at a line break is
 *  word-splitting rather than punctuation, so the two halves are joined
 *  back into one word — otherwise every wrapped word on the page would
 *  differ from the same word in the quote. */
export function toWords(raw: string): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = -1;

  const close = (end: number) => {
    if (text) words.push({ text, start, end });
    text = "";
    start = -1;
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if ((ch === "-" || ch === "­") && text) {
      // Look past the break: letters on the far side mean one word.
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (j > i + 1 && WORDY.test(fold(raw[j] ?? ""))) {
        i = j - 1;
        continue;
      }
    }
    const folded = fold(ch);
    if (folded && WORDY.test(folded)) {
      if (start < 0) start = i;
      text += folded;
    } else {
      close(i);
    }
  }
  close(raw.length);
  return words;
}

function sameAt(page: Word[], at: number, needle: string[]): boolean {
  for (let k = 0; k < needle.length; k++) {
    if (page[at + k]?.text !== needle[k]) return false;
  }
  return true;
}

/** Every place the given words appear in sequence. */
function anchors(page: Word[], needle: string[]): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  for (let i = 0; i + needle.length <= page.length; i++) {
    if (sameAt(page, i, needle)) out.push(i);
  }
  return out;
}

/** How much of the quote's middle turns up, in order, inside a span.
 *  This is what separates two candidates that share the same opening
 *  and closing words. */
function interiorScore(
  page: Word[],
  from: number,
  to: number,
  interior: string[],
): number {
  if (interior.length === 0) return 1;
  let found = 0;
  let at = from;
  for (const word of interior) {
    let i = at;
    while (i <= to && page[i].text !== word) i++;
    if (i <= to) {
      found++;
      at = i + 1;
    }
  }
  return found / interior.length;
}

/** Word indices of the span the quote refers to, or null. */
function matchWords(page: Word[], quote: string[]): [number, number] | null {
  if (quote.length === 0 || page.length === 0) return null;

  // A pair of words is specific enough to anchor on and short enough to
  // survive an extraction that mangled one of them; one word is the
  // fallback for a very short quote or a mangled pair.
  const heads = (n: number) => anchors(page, quote.slice(0, n));
  const tails = (n: number) =>
    anchors(page, quote.slice(Math.max(0, quote.length - n))).map(
      (i) => i + Math.min(n, quote.length) - 1,
    );

  const starts = quote.length >= 2 && heads(2).length ? heads(2) : heads(1);
  const ends = quote.length >= 2 && tails(2).length ? tails(2) : tails(1);
  if (starts.length === 0 || ends.length === 0) return null;

  const want = quote.length;
  const interior = quote.slice(
    Math.min(2, want),
    Math.max(Math.min(2, want), want - 2),
  );

  let best: { from: number; to: number; score: number; drift: number } | null =
    null;
  for (const from of starts) {
    // The nearest plausible end wins: a passage is contiguous, so the
    // first closing anchor after the opening one is the one meant.
    for (const to of ends) {
      if (to < from) continue;
      const span = to - from + 1;
      // Extraction adds and drops the odd word; anything wildly longer
      // or shorter than the quote is a different passage.
      if (span < want * 0.5 || span > want * 2 + 6) continue;
      const score = interiorScore(page, from, to, interior);
      const drift = Math.abs(span - want);
      if (
        !best ||
        score > best.score + 0.001 ||
        (Math.abs(score - best.score) <= 0.001 && drift < best.drift)
      ) {
        best = { from, to, score, drift };
      }
      break;
    }
  }
  // Both ends matching is suggestive; the middle is what makes it
  // certain. Below half, assume a different passage and highlight none.
  if (!best || best.score < 0.5) return null;
  return [best.from, best.to];
}

/** Rectangles covering a quotation, in PDF user space. One per text run
 *  the match touches; the first and last are trimmed to the characters
 *  actually inside the match, which assumes even character widths — an
 *  approximation a highlight can carry. */
export function locateQuote(runs: TextRun[], quote: string): HighlightRect[] {
  if (!quote.trim()) return [];
  const raw = runs.map((r) => r.str + (r.eol ? "\n" : "")).join("");
  const pageWords = toWords(raw);
  const quoteWords = toWords(quote).map((w) => w.text);
  const span = matchWords(pageWords, quoteWords);
  if (!span) return [];

  const rangeStart = pageWords[span[0]].start;
  const rangeEnd = pageWords[span[1]].end;

  const rects: HighlightRect[] = [];
  let cursor = 0;
  for (const run of runs) {
    const start = cursor;
    const end = start + run.str.length;
    cursor = end + (run.eol ? 1 : 0);
    if (end <= rangeStart || start >= rangeEnd) continue;
    if (run.str.length === 0 || run.width <= 0) continue;

    const from = Math.max(0, rangeStart - start);
    const to = Math.min(run.str.length, rangeEnd - start);
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
