// Page citations: the one thing an answer says that the app has to
// understand rather than just display.
//
// The model is asked for one form — [[cite:W:P:passage]], W the work's
// number in the source list, P the page number from the nearest page
// marker, and an optional exact quotation from that page — so there is a
// single thing to get right. Parsing is looser than the instruction on
// purpose: a citation that arrives as [[cite: 2 : 7 ]] or [[cite:2:7-9]]
// or [[p:2:7]] still resolves, and a malformed one degrades to the plain
// text the model wrote rather than vanishing or breaking the surrounding
// Markdown.
//
// They become links with a private scheme on the way to the renderer,
// which lets the existing Markdown pipeline carry them: a link is a
// first-class node, so nothing has to walk the tree looking for text to
// pattern-match.

export const CITE_SCHEME = "zh-cite:";

export interface Citation {
  /** 1-based index into the chat's works; null when the citation named
   *  only a page and the chat has more than one work to choose from. */
  work: number | null;
  page: number;
  /** End of a cited range, when one was given. */
  pageEnd: number | null;
  /** The passage the claim rests on, for highlighting on the rendered
   *  page. Empty when the model cited a page but no words. */
  quote: string;
}

/** Deliberately permissive: any of cite/page/p, any separator, optional
 *  range, whitespace wherever. The one thing it insists on is the
 *  double brackets, which is what keeps it from firing on ordinary
 *  prose like "[2]" or "(p. 7)".
 *
 *  The quote runs to the closing brackets and may contain a single "]"
 *  on the way — which it will, constantly, because half of scholarly
 *  prose cites like "[10] found the opposite". Rejecting those threw
 *  the whole citation away and left the raw [[cite:…]] text sitting in
 *  the answer. */
const CITE_RE =
  /\[\[\s*(?:cite|pages?|pp?)\s*[:.]?\s*(\d{1,5})\s*(?:[:,.]\s*(\d{1,5}))?\s*(?:[-–—]\s*(\d{1,5}))?\s*(?::\s*((?:[^\]]|\](?!\])){1,400}?))?\s*\]\]/gi;

type Groups = [string, string?, string?, string?];

function fromMatch([a, b, c, q]: Groups): Citation {
  // Two leading numbers means work + page; one means page alone.
  const work = b ? Number(a) : null;
  const page = Number(b ?? a);
  const end = c ? Number(c) : null;
  return {
    work,
    page,
    pageEnd: end && end > page ? end : null,
    quote: (q ?? "").trim(),
  };
}

/** What the pill reads. Just the page: the two buttons beside it say
 *  what can be done with it, and a sentence of prose does not need
 *  "See on" repeated through it a dozen times. */
export function citationLabel(cite: Citation): string {
  return cite.pageEnd
    ? `pp. ${cite.page}–${cite.pageEnd}`
    : `p. ${cite.page}`;
}

/** Markdown link destinations end at an unescaped ")", and a quotation
 *  will contain them sooner or later. */
function encodeQuote(quote: string): string {
  return encodeURIComponent(quote).replace(/[()]/g, (c) =>
    c === "(" ? "%28" : "%29",
  );
}

function toHref(cite: Citation): string {
  return [
    `${CITE_SCHEME}${cite.work ?? 0}`,
    cite.page,
    cite.pageEnd ?? 0,
    encodeQuote(cite.quote),
  ].join(":");
}

export function parseCiteHref(href: string): Citation | null {
  if (!href.startsWith(CITE_SCHEME)) return null;
  const [w, p, e, ...rest] = href.slice(CITE_SCHEME.length).split(":");
  const page = Number(p);
  if (!Number.isFinite(page) || page <= 0) return null;
  let quote = "";
  try {
    // The quote is the tail, so a colon inside it survives the split.
    quote = decodeURIComponent(rest.join(":"));
  } catch {
    quote = "";
  }
  return {
    work: Number(w) > 0 ? Number(w) : null,
    page,
    pageEnd: Number(e) > 0 ? Number(e) : null,
    quote,
  };
}

/** Rewrite every citation in a reply as a Markdown link the renderer
 *  turns into a pill. Fenced code is left alone — a citation inside a
 *  code block is being shown, not made. */
export function linkifyCitations(markdown: string): string {
  // Split on fences, keeping them: even indices are prose, odd are code.
  const parts = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(CITE_RE, (whole, ...g) => {
        const cite = fromMatch(g as Groups);
        if (!Number.isFinite(cite.page) || cite.page <= 0) return whole;
        // Brackets in the label would close the link early.
        return `[${citationLabel(cite)}](${toHref(cite)})`;
      });
    })
    .join("");
}

/** Strip citations back to readable prose, for the Markdown export —
 *  the private scheme means nothing outside this app. */
export function plainCitations(markdown: string): string {
  return markdown.replace(CITE_RE, (whole, ...g) => {
    const cite = fromMatch(g as Groups);
    if (!Number.isFinite(cite.page) || cite.page <= 0) return whole;
    const pages = cite.pageEnd
      ? `pp. ${cite.page}–${cite.pageEnd}`
      : `p. ${cite.page}`;
    const where = cite.work ? `work ${cite.work}, ${pages}` : pages;
    return cite.quote ? `(${where}: “${cite.quote}”)` : `(${where})`;
  });
}
