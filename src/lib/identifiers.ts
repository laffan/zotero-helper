// Identifier extraction for "Import IDs": pulls DOIs, arXiv IDs, ISBNs,
// and URLs out of free text — prose, bibliographies, notes with several
// identifiers per line — not just clean one-per-line lists. Lines with
// no recognizable identifier fall back to the old bare-token behavior
// (so unusual identifiers still import), and prose-only lines are
// ignored rather than queued as garbage.

const DOI_RE = /\b10\.\d{4,9}\/[^\s,;]+/g;
const ARXIV_ID_RE = /\barxiv:\s*(\d{4}\.\d{4,5})(v\d+)?/gi;
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/gi;
const ISBN_RE = /\b97[89][-\s]?(?:\d[-\s]?){9}\d\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

/** Strip trailing punctuation that belongs to the surrounding prose —
 *  including an unbalanced closing paren, while keeping the balanced
 *  parens some DOIs legitimately contain (10.1016/S0140-6736(20)…). */
function trimTrailing(s: string): string {
  for (;;) {
    const last = s[s.length - 1];
    if (!last) return s;
    if (".,;:!?'\"”’]}".includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (s.match(/\(/g) ?? []).length;
      const closes = (s.match(/\)/g) ?? []).length;
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

export function extractIdentifiers(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  };

  for (const line of raw.split(/\n+/)) {
    let matched = false;
    for (const m of line.matchAll(DOI_RE)) {
      push(trimTrailing(m[0]));
      matched = true;
    }
    for (const m of line.matchAll(ARXIV_ID_RE)) {
      push(`arXiv:${m[1]}${m[2] ?? ""}`);
      matched = true;
    }
    for (const m of line.matchAll(ARXIV_URL_RE)) {
      push(`arXiv:${m[1]}${m[2] ?? ""}`);
      matched = true;
    }
    for (const m of line.matchAll(ISBN_RE)) {
      push(m[0].replace(/[-\s]/g, ""));
      matched = true;
    }
    for (const m of line.matchAll(URL_RE)) {
      const url = trimTrailing(m[0]);
      // doi.org / arxiv.org URLs were already captured as identifiers.
      if (/\bdoi\.org\b/i.test(url) || /\barxiv\.org\b/i.test(url)) continue;
      push(url);
      matched = true;
    }
    if (!matched) {
      // Old behavior: bare identifier tokens, comma/semicolon separated.
      // Anything containing spaces here is prose — skip it.
      for (const tok of line.split(/[;,]+/)) {
        const t = tok.trim();
        if (t && !/\s/.test(t)) push(t);
      }
    }
  }
  return out;
}
