// The Post-its tab: the post-its on the selection's PDFs (lib/postits.ts),
// in reading order, each as it looks on its page — the paper in its
// colour, its words and its writing, drawn smaller — with its page
// under it. With the PDF open beside the panel a click goes to the
// post-it in the pages; otherwise it opens the PDF there. Several PDFs
// list under a heading each. The tab shows only when there are post-its
// (MetadataPanel.tsx).
import { useMemo } from "react";
import { attachmentName, itemTitle } from "../lib/collections";
import { annotatableAttachments, annotationIndexFor } from "../lib/highlights";
import { POSTIT_FONT, POSTIT_GRIP, POSTIT_LINE, POSTIT_PAD, POSTIT_PEN, postItsOf, type PostIt } from "../lib/postits";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { pathD } from "../pdfviewer/ink/geometry";
import { goToReaderPosition, openReaderAt } from "./ReaderPane";

/** A card's width, CSS px at the UI's font size. */
const CARD_PX = 180;

export interface PostItGroup {
  item: ZItem;
  att: ZItem;
  list: PostIt[];
}

/** Every PDF of the given entries with post-its on it. */
export function postItGroups(library: ZItem[], items: ZItem[]): PostItGroup[] {
  const index = annotationIndexFor(library);
  const out: PostItGroup[] = [];
  for (const item of items) {
    for (const att of annotatableAttachments(library, item)) {
      const list = postItsOf(index.get(att.key) ?? []);
      if (list.length) out.push({ item, att, list });
    }
  }
  return out;
}

export function PostItsPanel({ items }: { items: ZItem[] }) {
  const library = useStore((s) => s.library.items);
  const openAttKey = useStore((s) => s.reading?.attKey ?? null);
  const groups = useMemo(() => postItGroups(library, items), [library, items]);
  const several = groups.length > 1;
  return (
    <div className="postit-list">
      {groups.map((g) => (
        <section key={g.att.key} className="postit-group">
          {several && (
            <div className="hl-group" title={attachmentName(g.att)}>
              {itemTitle(g.item)}
              <span className="hl-group-file"> — {attachmentName(g.att)}</span>
            </div>
          )}
          <div className="postit-cards">
            {g.list.map((p) => (
              <PostItCard key={p.id} p={p} open={g.att.key === openAttKey} item={g.item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PostItCard({ p, open, item }: { p: PostIt; open: boolean; item: ZItem }) {
  const [w, h] = [p.rect[2] - p.rect[0], p.rect[3] - p.rect[1]];
  const go = () => {
    if (open) goToReaderPosition(p.pageIndex, p.rect[3]);
    else openReaderAt(item.key, p.attKey, p.pageIndex + 1, { tab: "postits" });
  };
  return (
    <button
      type="button"
      className="postit-card"
      onClick={go}
      title={open ? "Show on its page" : "Open the PDF at this post-it"}
      style={{ "--postit-color": p.color, "--pk": `calc(${CARD_PX / w}px * var(--font-scale))` } as React.CSSProperties}
    >
      <span className="postit-card-paper" style={{ aspectRatio: `${w} / ${h}` }}>
        <span
          className="postit-card-text"
          style={{
            top: `calc(var(--pk) * ${POSTIT_GRIP + POSTIT_PAD / 2})`,
            fontSize: `calc(var(--pk) * ${POSTIT_FONT})`,
            lineHeight: POSTIT_LINE,
            padding: `0 calc(var(--pk) * ${POSTIT_PAD})`,
          }}
        >
          {p.text}
        </span>
        <svg className="postit-card-ink" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          {p.strokes.map((s, i) => (
            <path key={i} d={pathD(s)} strokeWidth={POSTIT_PEN} />
          ))}
        </svg>
      </span>
      <span className="postit-card-page">p. {p.pageLabel || p.pageIndex + 1}</span>
    </button>
  );
}
