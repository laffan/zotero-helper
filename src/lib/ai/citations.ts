// Page citations: the one thing an answer says that the app has to
// understand rather than just display.
//
// The model is asked for exactly one form — [[cite:W:P]], W the work's
// number in the source list, P the page number from the nearest page
// marker — so there is a single thing to get right. Parsing is looser
// than the instruction on purpose: a citation that arrives as
// [[cite: 2 : 7 ]] or [[cite:2:7-9]] or [[p:2:7]] still resolves, and a
// malformed one degrades to the plain text the model wrote rather than
// vanishing or breaking the surrounding Markdown.
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
}

/** Deliberately permissive: any of cite/page/p, any separator, optional
 *  range, whitespace wherever. The one thing it insists on is the
 *  double brackets, which is what keeps it from firing on ordinary
 *  prose like "[2]" or "(p. 7)". */
const CITE_RE =
  /\[\[\s*(?:cite|pages?|pp?)\s*[:.]?\s*(\d{1,5})\s*(?:[:,.]\s*(\d{1,5}))?\s*(?:[-–—]\s*(\d{1,5}))?\s*\]\]/gi;

function fromMatch(a: string, b?: string, c?: string): Citation {
  // Two leading numbers means work + page; one means page alone.
  const work = b ? Number(a) : null;
  const page = Number(b ?? a);
  const end = c ? Number(c) : null;
  return { work, page, pageEnd: end && end > page ? end : null };
}

export function citationLabel(cite: Citation): string {
  return cite.pageEnd
    ? `See on pp. ${cite.page}–${cite.pageEnd}`
    : `See on p. ${cite.page}`;
}

function toHref(cite: Citation): string {
  return `${CITE_SCHEME}${cite.work ?? 0}:${cite.page}:${cite.pageEnd ?? 0}`;
}

export function parseCiteHref(href: string): Citation | null {
  if (!href.startsWith(CITE_SCHEME)) return null;
  const [w, p, e] = href.slice(CITE_SCHEME.length).split(":").map(Number);
  if (!Number.isFinite(p) || p <= 0) return null;
  return {
    work: w > 0 ? w : null,
    page: p,
    pageEnd: e > 0 ? e : null,
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
      return part.replace(CITE_RE, (whole, a: string, b?: string, c?: string) => {
        const cite = fromMatch(a, b, c);
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
  return markdown.replace(CITE_RE, (whole, a: string, b?: string, c?: string) => {
    const cite = fromMatch(a, b, c);
    if (!Number.isFinite(cite.page) || cite.page <= 0) return whole;
    const pages = cite.pageEnd ? `pp. ${cite.page}–${cite.pageEnd}` : `p. ${cite.page}`;
    return cite.work ? `(work ${cite.work}, ${pages})` : `(${pages})`;
  });
}
