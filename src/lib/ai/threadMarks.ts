// Where a clarification's passage is in its answer (threads.ts), both
// ways: measured from a selection in the rendered answer, and marked
// when the answer is rendered again — the passages asked about,
// highlighted, the one whose column is open more strongly
// (ThreadStrip.tsx).
//
// A passage is kept as offsets into the answer's rendered text, and
// both sides count the same characters: every one but white space —
// the same Markdown rendered twice can differ in its white space (the
// renderer drops it between a table's rows; blocks are separated by
// line breaks in one tree and not the other), never in the rest — and
// none of a citation pill's, whose words the page draws (CitePill:
// "p. 12", an author) where the tree being marked has the citation's
// link. So the marks are made in the Markdown pipeline itself, as
// `<mark>` elements React renders like any other: they reflow with the
// text, and a tap on one is an ordinary click.
import { parseCiteHref } from "./citations";

/** A passage to mark: its thread, its offsets, and whether its column
 *  is the one open. */
export interface ThreadMark {
  id: string;
  start: number;
  end: number;
  on: boolean;
}

const WHITE = /\s/u;
/** The rendered citation's element, whose words aren't counted. */
const PILL = ".cite-pill";

/** How many characters of `s` are counted: all but white space. */
function counted(s: string): number {
  let n = 0;
  for (const ch of s) if (!WHITE.test(ch)) n++;
  return n;
}

/** Where in `s` the counted offset `k` falls: before the (k+1)th
 *  counted character (`start`: white space before it goes with what
 *  comes before), or just after the kth (`end`: white space after it
 *  goes with what comes after). */
function indexAt(s: string, k: number, edge: "start" | "end"): number {
  if (k <= 0 && edge === "end") return 0;
  let n = 0;
  let i = 0;
  for (const ch of s) {
    if (!WHITE.test(ch)) {
      if (edge === "start" && n === k) return i;
      n++;
      if (edge === "end" && n === k) return i + ch.length;
    }
    i += ch.length;
  }
  return s.length;
}

/** The counted characters of `body` before the point (node, offset). */
function countBefore(body: Element, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(body, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  let n = 0;
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const text = t as Text;
    if (text.parentElement?.closest(PILL)) continue;
    if (!range.intersectsNode(text)) break;
    n += text === node ? counted(text.data.slice(0, offset)) : counted(text.data);
  }
  return n;
}

/** A selection in a rendered answer (`body`) as a passage: its words
 *  and offsets. The part of it outside the answer is let go of; null
 *  when nothing of it is inside, or nothing but white space. */
export function passageOf(body: Element, range: Range): { quote: string; start: number; end: number } | null {
  const r = range.cloneRange();
  if (!body.contains(r.startContainer)) r.setStart(body, 0);
  if (!body.contains(r.endContainer)) r.setEnd(body, body.childNodes.length);
  const quote = r.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;
  const start = countBefore(body, r.startContainer, r.startOffset);
  const end = countBefore(body, r.endContainer, r.endOffset);
  return end > start ? { quote, start, end } : null;
}

// Just enough of the HTML syntax tree (hast) the Markdown pipeline
// hands its plugins.
interface HText {
  type: "text";
  value: string;
}
interface HParent {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}
type HNode = HText | HParent;

const isPill = (n: HParent) =>
  n.type === "element" && n.tagName === "a" && parseCiteHref(String(n.properties?.href ?? "")) !== null;

/** The mark over the stretch [a, b): the open one, if it covers it,
 *  else the latest asked. */
function cover(marks: ThreadMark[], a: number, b: number): ThreadMark | undefined {
  const over = marks.filter((m) => m.start <= a && m.end >= b);
  return over.find((m) => m.on) ?? over[over.length - 1];
}

/** A text node, cut where marks begin and end, the marked pieces in
 *  `<mark>`s. `from`: the counted characters before it. */
function cut(value: string, from: number, marks: ThreadMark[]): HNode[] {
  const to = from + counted(value);
  const edges = new Set([from, to]);
  for (const m of marks) {
    if (m.start > from && m.start < to) edges.add(m.start);
    if (m.end > from && m.end < to) edges.add(m.end);
  }
  const at = [...edges].sort((x, y) => x - y);
  if (at.length === 2 && !cover(marks, from, to)) return [{ type: "text", value }];
  // Each edge's place in the string, its white space given to the
  // unmarked side.
  const place = at.map((c, i) => {
    if (c === from) return 0;
    if (c === to) return value.length;
    const after = cover(marks, c, at[i + 1]);
    return indexAt(value, c - from, after ? "start" : "end");
  });
  const out: HNode[] = [];
  const text = (v: string) => v && out.push({ type: "text", value: v });
  for (let i = 0; i < at.length - 1; i++) {
    const piece = value.slice(place[i], place[i + 1]);
    const m = cover(marks, at[i], at[i + 1]);
    if (!m) {
      text(piece);
      continue;
    }
    // White space at a passage's own ends stays outside its mark (a
    // passage running on across emphasis keeps the spaces inside it).
    const lead = m.start === at[i] ? (/^\s*/u.exec(piece)?.[0] ?? "") : "";
    const rest = piece.slice(lead.length);
    const trail = m.end === at[i + 1] ? (/\s*$/u.exec(rest)?.[0] ?? "") : "";
    const body = rest.slice(0, rest.length - trail.length);
    text(lead);
    if (body) {
      out.push({
        type: "element",
        tagName: "mark",
        properties: { className: m.on ? ["thread-mark", "on"] : ["thread-mark"], dataThread: m.id },
        children: [{ type: "text", value: body }],
      });
    }
    text(trail);
  }
  return out;
}

/** The rehype plugin: marks the passages of `marks` in the answer. */
export function rehypeThreadMarks(options: { marks: ThreadMark[] }) {
  const marks = options.marks.filter((m) => m.end > m.start);
  return (tree: HParent) => {
    if (!marks.length) return;
    let pos = 0;
    const walk = (parent: HParent) => {
      if (!parent.children) return;
      const out: HNode[] = [];
      for (const node of parent.children) {
        if (node.type === "text") {
          const value = (node as HText).value;
          const here = marks.filter((m) => m.end > pos && m.start < pos + counted(value));
          out.push(...(here.length ? cut(value, pos, here) : [node]));
          pos += counted(value);
          continue;
        }
        if (!isPill(node as HParent)) walk(node as HParent);
        out.push(node);
      }
      parent.children = out;
    };
    walk(tree);
  };
}
