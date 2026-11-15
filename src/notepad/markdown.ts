// Markdown in the notepad's text notes (texts.ts), read as Hush's
// notebook reads a text shape (Hush's src/notebook/markdown.ts, ported):
// each line on its own — no paragraphs run together, a blank line is a
// blank line — with `#`, `##` and `###` headings (1.8, 1.4 and 1.15
// times the size, in the heading colour, not bold), **bold**, *italic*
// or _italic_, [links](url), ==highlights==, `> ` quotes (italic, a
// shade lighter, a rule down the left), `- [ ]` / `- [x]` tasks, and
// `-`, `*`, `+` or `1.` lists, a level for every two spaces before the
// marker. A line's prefixes are read in that order — a quote, then a
// task or a list item, then a heading — so `> - [ ] a` is a task in a
// quote. Hush's own additions (wikilinks, flags, YOUAREHERE) have
// nothing to point at here and are left out.
//
// Drawn as DOM, not paint: the pad's chips are elements (links.ts). Each
// run is set as text, never as HTML, so a note's words can't become
// markup.

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  highlight?: boolean;
  /** A link's URL. */
  link?: string;
}

export interface Line {
  runs: Run[];
  /** 1–3, or 0 for none. */
  heading: number;
  quote: boolean;
  /** A task, ticked or not. */
  task?: boolean;
  /** A list item: its marker ("•", "3.") and how deep it is. */
  list?: { marker: string; depth: number };
}

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)]+)\)|==(.+?)==/g;

/** Bold, italic, links and highlights; a highlight's own text is read
 *  again, so formatting inside `==…==` survives. */
function inline(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else if (m[2] !== undefined || m[3] !== undefined) runs.push({ text: m[2] ?? m[3], italic: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], link: m[5] });
    else if (m[6] !== undefined) for (const r of inline(m[6])) runs.push({ ...r, highlight: true });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

export function parseLine(raw: string): Line {
  let s = raw;
  const quote = /^>+\s?(.*)$/.exec(s);
  if (quote) s = quote[1];
  let task: boolean | undefined;
  const t = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(s);
  if (t) {
    task = t[1] !== " ";
    s = t[2];
  }
  let list: Line["list"];
  if (!t) {
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(s);
    const numbered = bullet ? null : /^(\s*)(\d+)[.)]\s+(.*)$/.exec(s);
    if (bullet) {
      list = { marker: "•", depth: Math.floor(bullet[1].length / 2) };
      s = bullet[2];
    } else if (numbered) {
      list = { marker: `${numbered[2]}.`, depth: Math.floor(numbered[1].length / 2) };
      s = numbered[3];
    }
  }
  let heading = 0;
  const h = /^(#{1,3})\s+(.*)$/.exec(s);
  if (h) {
    heading = h[1].length;
    s = h[2];
  }
  const runs = inline(s);
  // A quote is set in italic, as a Hush Doc sets one.
  if (quote) for (const r of runs) r.italic = true;
  return { runs, heading, quote: Boolean(quote), task, list };
}

/** The text with the task on line `index` ticked, or unticked; null
 *  when that line holds no task. */
export function toggleTask(text: string, index: number): string | null {
  const lines = text.split("\n");
  const m = /^((?:>+\s?)?\s*[-*+]\s+)\[([ xX])\](\s+.*)$/.exec(lines[index] ?? "");
  if (!m) return null;
  lines[index] = `${m[1]}[${m[2] === " " ? "x" : " "}]${m[3]}`;
  return lines.join("\n");
}

// Gutters, in ems of the note's type (Hush's, from its font size): a
// quote's rule and the space after it, a list's step per level and its
// marker's column, a task's box and the gap after it.
const QUOTE_EM = 0.9;
const DEPTH_EM = 1.2;
const MARKER_EM = 1.5;
const BOX_EM = 0.85;
const BOX_GAP_EM = 0.4;

const TICK_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M22 55L42 78L82 25" vector-effect="non-scaling-stroke"/></svg>`;

function span(cls: string, text = ""): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  el.textContent = text;
  return el;
}

/** One line: its rule, marker or box in the gutter, then its words, so
 *  that a line that wraps hangs under its first word. */
function lineEl(line: Line, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "notepad-text-line";
  if (line.heading) el.classList.add(`h${line.heading}`);
  if (line.quote) el.classList.add("quote");
  let left = line.quote ? QUOTE_EM : 0;
  if (line.list) {
    const marker = span("notepad-text-marker", line.list.marker);
    left += DEPTH_EM * line.list.depth;
    marker.style.left = `${left}em`;
    el.appendChild(marker);
    left += MARKER_EM;
  } else if (line.task !== undefined) {
    const box = span(line.task ? "notepad-text-box done" : "notepad-text-box");
    box.dataset.task = String(index);
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(line.task));
    box.style.left = `${left}em`;
    if (line.task) box.innerHTML = TICK_SVG;
    el.appendChild(box);
    left += BOX_EM + BOX_GAP_EM;
  }
  if (left) el.style.paddingLeft = `${left}em`;
  const words = span("notepad-text-words");
  for (const r of line.runs) {
    if (!r.text) continue;
    const cls = [r.bold && "b", r.italic && "i", r.highlight && "hl", r.link && "ln"].filter(Boolean).join(" ");
    const run = span(cls, r.text);
    if (r.link) run.dataset.href = r.link;
    words.appendChild(run);
  }
  // An empty line keeps its height.
  if (!words.firstChild) words.appendChild(document.createElement("br"));
  el.appendChild(words);
  return el;
}

/** A text note's words, set: one element per line. */
export function renderText(text: string): HTMLElement {
  const body = document.createElement("div");
  body.className = "notepad-text-body";
  text.split("\n").forEach((raw, i) => body.appendChild(lineEl(parseLine(raw), i)));
  return body;
}
