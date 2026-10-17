// ⌘-click on a line of the pages: the sentence it falls in is marked
// at once — highlighted or underlined, as the selection bar's switch is
// set, in the colour last chosen there. In reading mode, with no
// keyboard at hand, the ⌘ button under the exit ring latches the same
// behaviour onto a plain tap (ReadingModeExit.tsx, the host's
// `latched`).
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
// either way, so a page with no punctuation can't be marked whole.
import { APPLE } from "../lib/shortcuts/bindings";
import { indexOf, layerText, rangeOf, textPositionAt } from "./textHit";

const MAX_REACH = 800;
const ABBREVIATIONS = new Set([
  "al", "cf", "ch", "chs", "dr", "ed", "eds", "eg", "esp", "etc", "fig", "figs", "ibid", "ie",
  "jr", "mr", "mrs", "ms", "no", "nos", "p", "pp", "prof", "sec", "sr", "st", "trans", "viz", "vol", "vols", "vs",
]);
const CLOSERS = "\"'”’)]»";
const OPENERS = "\"'“‘([«";

function endsSentence(s: string, i: number): boolean {
  if (!".!?".includes(s[i])) return false;
  let j = i + 1;
  while (j < s.length && CLOSERS.includes(s[j])) j++;
  if (j < s.length && !/\s/.test(s[j])) return false;
  while (j < s.length && /\s/.test(s[j])) j++;
  if (j < s.length && !/[\p{Lu}\d]/u.test(s[j]) && !OPENERS.includes(s[j])) return false;
  if (s[i] === ".") {
    const word = /([\p{L}.]+)$/u.exec(s.slice(Math.max(0, i - 12), i))?.[1] ?? "";
    const bare = word.replace(/\./g, "").toLowerCase();
    if (bare.length === 1 || ABBREVIATIONS.has(bare)) return false;
  }
  return true;
}

/** [from, to) of the sentence around index `at` of `s`, trimmed. */
export function sentenceBounds(s: string, at: number): [number, number] {
  let from = Math.max(0, at - MAX_REACH);
  for (let i = Math.min(at, s.length) - 1; i >= from; i--) {
    if (endsSentence(s, i)) {
      from = i + 1;
      break;
    }
  }
  let to = Math.min(s.length, at + MAX_REACH);
  for (let i = Math.max(at, from); i < to; i++) {
    if (endsSentence(s, i)) {
      to = i + 1;
      while (to < s.length && CLOSERS.includes(s[to])) to++;
      break;
    }
  }
  while (from < to && /\s/.test(s[from])) from++;
  while (to > from && /\s/.test(s[to - 1])) to--;
  return [from, to];
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
  const [from, to] = sentenceBounds(t.text, at);
  return to > from ? rangeOf(t, from, to) : null;
}

export interface SentenceMarkEnv {
  /** Mark this sentence (the selection bar's mode and last colour). */
  mark: (range: Range) => void;
  /** A plain tap marks too (reading mode's ⌘ button). */
  latched?: () => boolean;
  /** Marking is possible here (not a fold's strip, not ink's pen). */
  enabled: () => boolean;
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

  // A drag is a selection, not a click on a sentence.
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onClick = (e: MouseEvent) => {
    const command = held || e.metaKey || (!APPLE && e.ctrlKey);
    if (!(command || env.latched?.()) || !env.enabled()) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const target = e.target as Element;
    if (target.closest("a, button, input, textarea")) return;
    const range = sentenceAt(target, e.clientX, e.clientY);
    if (!range) return;
    // Not a click on the highlight or link beneath, nor a selection.
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    env.mark(range);
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
