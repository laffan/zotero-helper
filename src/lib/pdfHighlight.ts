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
// The other half of the problem is that a quote is not always *on* the
// page as one stretch of words. LiteParse reads spatially, so a
// two-column paper's title block comes out interleaved, a paragraph
// crossing a column break comes out spliced, and body text runs
// straight into the copyright footer. The model quotes what it was
// given, faithfully, and no amount of matching will find that sequence
// on the page, because it isn't there. So when the whole quote can't be
// placed, the longest stretch of it that *is* contiguous gets
// highlighted instead — which is the part the reader wants to see
// anyway.
//
// A miss is still expected and fine: the page renders without a
// highlight. A wrong highlight would be worse than none, so both the
// whole-quote and the partial paths have to clear a bar first.

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

/** The longest stretch of the quote that appears contiguously on the
 *  page. This is what rescues a quote the extractor spliced together
 *  out of two parts of the page: one of the parts is still there, whole.
 *
 *  Classic longest-common-substring, over words rather than characters,
 *  with a rolling row — a 40-word quote against an 800-word page is
 *  32,000 comparisons, which is nothing per page. */
function longestRun(
  page: Word[],
  quote: string[],
): { span: [number, number] | null; best: number } {
  let prev = new Uint16Array(quote.length + 1);
  let best = 0;
  let bestEnd = -1;
  for (let i = 0; i < page.length; i++) {
    const row = new Uint16Array(quote.length + 1);
    for (let j = 0; j < quote.length; j++) {
      if (page[i].text !== quote[j]) continue;
      const len = prev[j] + 1;
      row[j + 1] = len;
      if (len > best) {
        best = len;
        bestEnd = i;
      }
    }
    prev = row;
  }
  // Long enough to be unmistakably the passage, and a real share of what
  // was quoted — a short stretch of a long quote is as likely to be a
  // stock phrase ("in this article we examine") as the sentence meant.
  const floor = Math.max(6, Math.ceil(quote.length * 0.45));
  return {
    span: best < floor ? null : [bestEnd - best + 1, bestEnd],
    // Reported either way: "the best run anywhere was three words" is
    // what tells you a quote is not in this document at all, as against
    // being there in a form the matcher missed.
    best,
  };
}

/** Word indices of the span the quote refers to, or null. `strict`
 *  refuses the partial fallback, which lets a caller sweep a document
 *  for a whole-quote match before settling for part of one. */
interface Match {
  span: [number, number] | null;
  /** True when the whole quote was placed, false for a partial run. */
  exact: boolean;
  /** Longest contiguous run found, whether or not it was accepted. */
  bestRun: number;
}

function matchWords(page: Word[], quote: string[], strict: boolean): Match {
  const none: Match = { span: null, exact: false, bestRun: 0 };
  if (quote.length === 0 || page.length === 0) return none;

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
  const fallback = (): Match => {
    if (strict) return none;
    const run = longestRun(page, quote);
    return { span: run.span, exact: false, bestRun: run.best };
  };
  if (starts.length === 0 || ends.length === 0) return fallback();

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
  // certain. Below half, assume a different passage.
  if (best && best.score >= 0.5) {
    return { span: [best.from, best.to], exact: true, bestRun: quote.length };
  }
  return fallback();
}

/** Rectangles covering a quotation, in PDF user space, and how many
 *  words they cover — a caller sweeping several pages uses that to
 *  prefer the page that matched most of the quote. One rect per text
 *  run the match touches; the first and last are trimmed to the
 *  characters actually inside the match, which assumes even character
 *  widths — an approximation a highlight can carry. */
export interface QuoteHit {
  rects: HighlightRect[];
  /** Words the highlight covers. */
  words: number;
  /** True when the whole quote was placed rather than part of it. */
  exact: boolean;
  /** Longest run found on this page, accepted or not. */
  bestRun: number;
  /** Words the page's text layer yielded — zero means a scan. */
  pageWords: number;
}

export function locateQuote(
  runs: TextRun[],
  quote: string,
  strict = false,
): QuoteHit {
  const raw = runs.map((r) => r.str + (r.eol ? "\n" : "")).join("");
  const pageWords = toWords(raw);
  const empty: QuoteHit = {
    rects: [],
    words: 0,
    exact: false,
    bestRun: 0,
    pageWords: pageWords.length,
  };
  if (!quote.trim()) return empty;
  const quoteWords = toWords(quote).map((w) => w.text);
  const match = matchWords(pageWords, quoteWords, strict);
  if (!match.span) return { ...empty, bestRun: match.bestRun };

  const span = match.span;
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
  return {
    rects,
    words: span[1] - span[0] + 1,
    exact: match.exact,
    bestRun: match.bestRun,
    pageWords: pageWords.length,
  };
}
