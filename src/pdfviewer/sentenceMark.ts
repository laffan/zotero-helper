// ⌘-click on a line of the pages: the sentence it falls in is
// selected, and the selection bar comes up over it to mark it in the
// colour of the reader's choosing (or quote, or explain it). With no
// keyboard at hand, the sentence tool latches the same onto a plain tap:
// the caret button in the bottom bar or in reading mode, or S
// (annotating.ts keeps it). While it is on, it selects only text nothing
// else has claimed: a tap on a highlight, an explained passage or a word
// looked up still does what it does without the tool; ⌘ always selects.
// A tap of the tool's while something in the pages is selected only
// lets go of that selection (selectionBar.ts dismisses it): the next tap
// selects, so a stray tap doesn't swap one sentence for another.
//
// A press something else has already answered — reading mode's notepad
// sliding to the other page (auto-shift) — is spared (`spareFromSentence`):
// its tap doesn't select too, unless it is a ⌘-click.
//
// ⌘ is read from its own keydown / keyup, as the reading crop reads ⌃
// (crop.ts): iPadOS doesn't report modifiers on pointer events
// reliably. A key-up can go missing there (an app switch, a system
// shortcut), so a keydown without ⌘ or a blur lets go of it. Off Apple
// platforms ⌘ is Ctrl, as everywhere in the app.
//
// A sentence runs between two sentence ends: ".", "!" or "?" (and any
// closing quote or bracket after it) followed by a space and then a
// capital, a digit or an opening quote — so "e.g. this" and "3.5" don't
// end one. Common abbreviations and single initials don't either. It
// never runs past its page, nor further than MAX_REACH characters
// either way, so a page with no punctuation can't be selected whole.
//
// A note's number set above the line after a sentence's end — an
// endnote or footnote mark, "…as he argued.¹² The next…" — belongs to
// the sentence it follows: the text layer has it as "argued.12 The",
// which read plainly is no end at all (no space after the "."), so two
// sentences ran together, or the next began with the number. The marks
// are found by their shape (`noteMarks`: a run of digits or a note's
// symbols, smaller than the text beside it and raised above its middle)
// and, where that can't tell, by their place — a word's "." followed at
// once (or after a closing quote) by one to three digits, a space and
// a capital.
import { APPLE } from "../lib/shortcuts/bindings";
import { indexOf, layerText, rangeOf, textPositionAt } from "./textHit";

const MAX_REACH = 800;
const ABBREVIATIONS = new Set([
  "al", "cf", "ch", "chs", "dr", "ed", "eds", "eg", "esp", "etc", "fig", "figs", "ibid", "ie",
  "jr", "mr", "mrs", "ms", "no", "nos", "p", "pp", "prof", "sec", "sr", "st", "trans", "viz", "vol", "vols", "vs",
]);
const CLOSERS = "\"'”’)]»";
const OPENERS = "\"'“‘([«";

/** Is character `i` part of a raised note mark? */
type Marks = (i: number) => boolean;
const NO_MARKS: Marks = () => false;

/** Where the note mark that starts at `j` ends, spaces before it
 *  allowed; `j` when none does. After a word's "." (`afterWord`; `j` is
 *  past any closing quote), a run of digits straight after it with a
 *  space and a capital beyond counts as one too. */
function pastMark(s: string, j: number, marks: Marks, afterWord: boolean): number {
  let k = j;
  while (k < s.length && /\s/.test(s[k])) k++;
  if (k < s.length && marks(k)) {
    while (k < s.length && marks(k)) k++;
    return k;
  }
  if (afterWord) {
    const m = /^\d{1,3}(?=\s+[\p{Lu}"“‘(\[])/u.exec(s.slice(j, j + 12));
    if (m) return j + m[0].length;
  }
  return j;
}

function endsSentence(s: string, i: number, marks: Marks = NO_MARKS): boolean {
  if (!".!?".includes(s[i])) return false;
  let j = i + 1;
  while (j < s.length && CLOSERS.includes(s[j])) j++;
  const k = pastMark(s, j, marks, /\p{L}/u.test(s[i - 1] ?? ""));
  if (k === j && j < s.length && !/\s/.test(s[j])) return false;
  j = k;
  while (j < s.length && /\s/.test(s[j])) j++;
  if (j < s.length && !/[\p{Lu}\d]/u.test(s[j]) && !OPENERS.includes(s[j])) return false;
  if (s[i] === ".") {
    const word = /([\p{L}.]+)$/u.exec(s.slice(Math.max(0, i - 12), i))?.[1] ?? "";
    const bare = word.replace(/\./g, "").toLowerCase();
    if (bare.length === 1 || ABBREVIATIONS.has(bare)) return false;
  }
  return true;
}

/** [from, to) of the sentence around index `at` of `s`, trimmed — a
 *  note mark after its end taken in, one before its start left out. */
export function sentenceBounds(s: string, at: number, marks: Marks = NO_MARKS): [number, number] {
  // A tap on a note mark is a tap on the sentence it ends.
  if (marks(at)) {
    while (at > 0 && (marks(at) || /\s/.test(s[at]))) at--;
    while (at > 0 && CLOSERS.includes(s[at])) at--;
  }
  let from = Math.max(0, at - MAX_REACH);
  for (let i = Math.min(at, s.length) - 1; i >= from; i--) {
    if (!endsSentence(s, i, marks)) continue;
    // The start: past the last sentence's closing quotes and its note
    // mark — digits that may be read as plain ones.
    from = i + 1;
    while (from < at && CLOSERS.includes(s[from])) from++;
    from = Math.min(at, pastMark(s, from, marks, /\p{L}/u.test(s[i - 1] ?? "")));
    break;
  }
  let to = Math.min(s.length, at + MAX_REACH);
  for (let i = Math.max(at, from); i < to; i++) {
    if (endsSentence(s, i, marks)) {
      to = i + 1;
      while (to < s.length && CLOSERS.includes(s[to])) to++;
      to = pastMark(s, to, marks, /\p{L}/u.test(s[i - 1] ?? ""));
      break;
    }
  }
  while (from < to && (/\s/.test(s[from]) || marks(from))) from++;
  while (to > from && /\s/.test(s[to - 1])) to--;
  return [from, to];
}

/** What a note mark looks like as the text layer has it: digits, or a
 *  note's symbols, with commas and dashes between ("1", "12", "3–5",
 *  "*", "†"). */
const MARK_TEXT = /^\s*[\d*†‡§¶][\d*†‡§¶,\-–]*\s*$/;

/** The note marks in a layer's text: each text node that reads as one
 *  and is set smaller than the text before it (or after it) and raised
 *  above that text's middle. Measured from the text's own boxes — a
 *  span's box is taller than its text on a touch screen. */
export function noteMarks(t: ReturnType<typeof layerText>): Marks {
  const box = (n: Text) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    return r.getBoundingClientRect();
  };
  const isText = (i: number) => t.nodes[i] && t.nodes[i].data.trim() && !MARK_TEXT.test(t.nodes[i].data);
  const at = new Set<number>();
  t.nodes.forEach((node, i) => {
    if (!MARK_TEXT.test(node.data)) return;
    let ref = i - 1;
    while (ref >= 0 && !isText(ref)) ref--;
    if (ref < 0) for (ref = i + 1; ref < t.nodes.length && !isText(ref); ref++);
    if (!t.nodes[ref]) return;
    const m = box(node);
    const r = box(t.nodes[ref]);
    if (!m.height || !r.height) return;
    const raised = m.top + m.height / 2 < r.top + r.height / 2 - r.height * 0.1;
    if (m.height < r.height * 0.85 && raised) at.add(i);
  });
  if (!at.size) return NO_MARKS;
  const marked = new Uint8Array(t.text.length);
  for (const i of at) {
    const node = t.nodes[i];
    for (let k = 0; k < node.length; k++) if (!/\s/.test(node.data[k])) marked[t.starts[i] + k] = 1;
  }
  return (i) => marked[i] === 1;
}

/** The sentence under a client point, as a Range in the page's text
 *  layer; null off the text. */
export function sentenceAt(target: Element, x: number, y: number): Range | null {
  const page = target.closest(".pdf-page-wrapper, .pdf-fold-wrapper.pdf-fold-expanded");
  const layer = page?.querySelector<HTMLElement>(".textLayer");
  if (!layer) return null;
  const pos = textPositionAt(layer, x, y);
  if (!pos) return null;
  const t = layerText(layer);
  const at = indexOf(t, pos);
  if (at < 0) return null;
  const [from, to] = sentenceBounds(t.text, at, noteMarks(t));
  return to > from ? rangeOf(t, from, to) : null;
}

/** The sentence a range starts in, as text — where a looked-up word was
 *  read. */
export function sentenceAround(range: Range): string {
  const node = range.startContainer;
  const layer = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".textLayer");
  if (!layer || !(node instanceof Text)) return "";
  const t = layerText(layer);
  const at = indexOf(t, { node, offset: range.startOffset });
  if (at < 0) return "";
  const [from, to] = sentenceBounds(t.text, at, noteMarks(t));
  return t.text.slice(from, to).replace(/\s+/g, " ").trim();
}

// Presses answered elsewhere, heard before the pages hear them (a
// window listener in the capture phase): the tool lets their taps be.
const spared = new WeakSet<Event>();

/** The tap this press begins is another's: the sentence tool doesn't
 *  select on it. Call it while the press's pointerdown is on its way to
 *  the pages. */
export function spareFromSentence(e: PointerEvent): void {
  spared.add(e);
}

export interface SentenceMarkEnv {
  /** A plain tap selects too (the sentence tool is on). */
  latched: () => boolean;
  /** Has something else claimed the text under this point — a
   *  highlight, a marked passage — whose own tap goes ahead of the tool? */
  claimed: (target: Element, x: number, y: number) => boolean;
  /** Selecting is possible here (not while the reading crop is set). */
  enabled: () => boolean;
}

/** Select `range`, and again a moment later should the iPad's own tap
 *  handling clear it as the tap settles. */
function select(range: Range): void {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
  window.setTimeout(() => {
    if (sel.isCollapsed && range.toString()) sel.addRange(range);
  }, 250);
}

export function attachSentenceMarks(scrollArea: HTMLElement, env: SentenceMarkEnv): () => void {
  let held = false;
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Meta") held = true;
    else if (!e.metaKey) held = false;
  };
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === "Meta") held = false;
  };
  const release = () => (held = false);

  // A drag is a selection, not a click on a sentence. Whether something
  // in the pages was selected as the press began: if so, the tool's tap
  // is the one that deselects. And whether the press was another's.
  let down: { x: number; y: number; selected: boolean; spared: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    const sel = window.getSelection();
    const selected = Boolean(sel && !sel.isCollapsed && sel.anchorNode && scrollArea.contains(sel.anchorNode));
    down = { x: e.clientX, y: e.clientY, selected, spared: spared.has(e) };
  };
  const onClick = (e: MouseEvent) => {
    const command = held || e.metaKey || (!APPLE && e.ctrlKey);
    if (!(command || env.latched()) || !env.enabled()) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    if (!command && (down?.selected || down?.spared)) return;
    const target = e.target as Element;
    if (target.closest("a, button, input, textarea")) return;
    if (!command && env.claimed(target, e.clientX, e.clientY)) return;
    const range = sentenceAt(target, e.clientX, e.clientY);
    if (!range) return;
    // Not a click on the highlight or link beneath.
    e.preventDefault();
    e.stopPropagation();
    select(range);
  };
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keyup", onKeyup, true);
  window.addEventListener("blur", release);
  scrollArea.addEventListener("pointerdown", onDown, true);
  scrollArea.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("keyup", onKeyup, true);
    window.removeEventListener("blur", release);
    scrollArea.removeEventListener("pointerdown", onDown, true);
    scrollArea.removeEventListener("click", onClick, true);
  };
}
