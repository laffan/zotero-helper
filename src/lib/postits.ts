// Post-its: little notepads stuck on a PDF's pages (the viewer's
// pdfviewer/postits.ts places, draws and edits them; the Post-its tab,
// components/PostItsPanel.tsx, lists them). A post-it is a square of
// coloured paper, POSTIT_SIZE points a side to begin with, holding typed
// text and the Pencil's writing.
//
// Zotero has no post-its, so each is kept as the annotations of Zotero's
// own that come nearest — and that Zotero desktop, iOS and the web
// library then show: its text as a *text* annotation (Zotero's text box,
// the words in its comment, drawn in POSTIT_INK inside the paper's
// margins), its writing as *ink* annotations (one, or several should the
// writing outgrow one annotation's position). The paper itself has no
// annotation of its own in Zotero; here it is drawn from the record each
// part carries in its position, beside what Zotero reads there:
// `zhPostIt` — the post-it's id (which ties its parts together), its
// colour and its rect. Zotero stores a position as it is given, and its
// reader keeps unknown keys when a text box is resized — but moving one
// there writes a new position without them, and the part becomes an
// ordinary text box or drawing again (drawn as such here too).
//
// A post-it always has at least one part: its text annotation while it
// has words, or no writing either (an empty post-it is an empty text
// box, so that it is kept); its ink while it has writing. `savePostIt`
// brings the parts in line with what the post-it holds — creating,
// updating and deleting as needed, through lib/annotationEdits.ts and so
// the same outbox and push as the highlights.
import { createAnnotation, deleteAnnotation, newItemKey, updateAnnotation } from "./annotationEdits";
import { annotationPosition, type Annotation } from "./highlights";

/** A new post-it's side, in PDF points: 200 × 200 at 100% zoom. */
export const POSTIT_SIZE = 200;
/** The band across its top (the grip it is dragged by), its margins and
 *  its type, in points. */
export const POSTIT_GRIP = 18;
export const POSTIT_PAD = 8;
export const POSTIT_FONT = 11;
export const POSTIT_LINE = 1.3;
/** Its writing: one pen, black, as on paper of any colour. */
export const POSTIT_PEN = 1.4;
export const POSTIT_INK = "#000000";
/** An ink annotation's position may be at most 65,535 characters
 *  (ink/geometry.ts keeps the same margin). */
const MAX_POSITION_CHARS = 60_000;

/** The usual colours of the paper. */
export const POSTIT_COLORS: ReadonlyArray<{ color: string; name: string }> = [
  { color: "#fff59d", name: "Yellow" },
  { color: "#ffc1dc", name: "Pink" },
  { color: "#b3e5fc", name: "Blue" },
  { color: "#c5e1a5", name: "Green" },
  { color: "#ffcc80", name: "Orange" },
];
const COLOR_KEY = "zh-postit-color";

/** The colour a new post-it takes: the one picked last on this device. */
export function lastPostItColor(): string {
  try {
    const c = localStorage.getItem(COLOR_KEY);
    if (c && POSTIT_COLORS.some((p) => p.color === c)) return c;
  } catch {
    /* storage unavailable */
  }
  return POSTIT_COLORS[0].color;
}
export function rememberPostItColor(color: string): void {
  try {
    localStorage.setItem(COLOR_KEY, color);
  } catch {
    /* storage unavailable */
  }
}

/** What each part carries in its position. `rect` is the paper's, in
 *  PDF user space ([x1, y1, x2, y2], y up). */
export interface PostItMeta {
  id: string;
  color: string;
  rect: number[];
}

/** A post-it, as its parts describe it. */
export interface PostIt {
  id: string;
  attKey: string;
  pageIndex: number;
  rect: number[];
  color: string;
  text: string;
  /** The writing: each stroke x, y pairs in points from the paper's top
   *  left, y down. */
  strokes: number[][];
  pageLabel: string;
  sortIndex: string;
  textKey: string | null;
  inkKeys: string[];
  /** The annotations it is made of. */
  parts: Annotation[];
}

/** A post-it's part's record, when the annotation is one. */
export function postItMeta(a: Annotation): PostItMeta | null {
  const m = (annotationPosition(a) as { zhPostIt?: Partial<PostItMeta> } | null)?.zhPostIt;
  if (!m || typeof m.id !== "string" || typeof m.color !== "string") return null;
  const r = m.rect;
  if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => Number.isFinite(v))) return null;
  return { id: m.id, color: m.color, rect: r };
}

export const isPostItPart = (a: Annotation): boolean => postItMeta(a) !== null;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The post-its among a PDF's annotations, in reading order. */
export function postItsOf(list: Annotation[]): PostIt[] {
  const byId = new Map<string, PostIt>();
  for (const a of list) {
    const m = postItMeta(a);
    const pos = annotationPosition(a);
    if (!m || !pos || typeof pos.pageIndex !== "number") continue;
    let p = byId.get(m.id);
    if (!p) {
      p = {
        id: m.id,
        attKey: a.attKey,
        pageIndex: pos.pageIndex,
        rect: m.rect,
        color: m.color,
        text: "",
        strokes: [],
        pageLabel: a.pageLabel,
        sortIndex: a.sortIndex,
        textKey: null,
        inkKeys: [],
        parts: [],
      };
      byId.set(m.id, p);
    }
    p.parts.push(a);
    if (a.type === "text") {
      // The text part's record is the one moved with the words.
      p.textKey = a.key;
      p.text = a.comment;
      p.rect = m.rect;
      p.color = m.color;
    } else if (a.type === "ink") {
      p.inkKeys.push(a.key);
      const [x1, , , y2] = m.rect;
      for (const path of pos.paths ?? []) {
        p.strokes.push(path.map((v, i) => round2(i % 2 ? y2 - v : v - x1)));
      }
    }
  }
  return [...byId.values()].sort((a, b) => (a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0));
}

/** What the viewer hands over to keep: the post-it as it is now, and the
 *  parts it had (none, for a new one). */
export interface PostItSave {
  attKey: string;
  id: string;
  pageIndex: number;
  pageLabel: string;
  sortIndex: string;
  rect: number[];
  color: string;
  text: string;
  strokes: number[][];
  textKey: string | null;
  inkKeys: string[];
}

/** The strokes as Zotero's ink paths, in groups that each fit one
 *  annotation's position. */
function inkGroups(p: PostItSave): number[][][] {
  const [x1, , , y2] = p.rect;
  const groups: number[][][] = [];
  let group: number[][] = [];
  let chars = 0;
  for (const s of p.strokes) {
    const path = s.map((v, i) => round2(i % 2 ? y2 - v : x1 + v));
    const size = JSON.stringify(path).length + 1;
    if (group.length && chars + size > MAX_POSITION_CHARS - 400) {
      groups.push(group);
      group = [];
      chars = 0;
    }
    group.push(path);
    chars += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

/** Bring a post-it's annotations in line with it; returns the keys of
 *  its parts now. */
export function savePostIt(p: PostItSave): { textKey: string | null; inkKeys: string[] } {
  const zhPostIt: PostItMeta = { id: p.id, color: p.color, rect: p.rect.map(round2) };
  const [x1, y1, x2, y2] = zhPostIt.rect;
  const common = { attKey: p.attKey, pageLabel: p.pageLabel, sortIndex: p.sortIndex };

  // The words, inside the paper's margins and below its grip.
  let textKey = p.textKey;
  if (p.text.trim() || !p.strokes.length) {
    const position = {
      pageIndex: p.pageIndex,
      fontSize: POSTIT_FONT,
      rotation: 0,
      rects: [[x1 + POSTIT_PAD, y1 + POSTIT_PAD, x2 - POSTIT_PAD, y2 - POSTIT_GRIP - POSTIT_PAD / 2].map(round2)],
      zhPostIt,
    };
    if (textKey) {
      updateAnnotation(textKey, { comment: p.text, position: JSON.stringify(position), sortIndex: p.sortIndex, color: POSTIT_INK });
    } else {
      textKey = newItemKey();
      createAnnotation({ ...common, type: "text", key: textKey, color: POSTIT_INK, comment: p.text, position });
    }
  } else if (textKey) {
    deleteAnnotation(textKey);
    textKey = null;
  }

  // The writing, in as many ink annotations as it needs.
  const inkKeys: string[] = [];
  inkGroups(p).forEach((paths, i) => {
    const position = { pageIndex: p.pageIndex, width: POSTIT_PEN, paths, zhPostIt };
    const key = p.inkKeys[i];
    if (key) {
      updateAnnotation(key, { position: JSON.stringify(position), sortIndex: p.sortIndex, color: POSTIT_INK });
      inkKeys.push(key);
    } else {
      const fresh = newItemKey();
      createAnnotation({ ...common, type: "ink", key: fresh, color: POSTIT_INK, position });
      inkKeys.push(fresh);
    }
  });
  for (const key of p.inkKeys.slice(inkKeys.length)) deleteAnnotation(key);
  return { textKey, inkKeys };
}

/** Take a post-it off its page: every part goes. */
export function deletePostIt(p: { textKey: string | null; inkKeys: string[] }): void {
  if (p.textKey) deleteAnnotation(p.textKey);
  for (const key of p.inkKeys) deleteAnnotation(key);
}

/** A post-it's words, wrapped to a width — the painter's and the tab's
 *  shared measure (`measure` gives a run's width). */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd()) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}
