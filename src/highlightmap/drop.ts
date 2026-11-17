// A link dropped on the Highlight Map: the notepad's quote button, or
// the notes' link icon, dragged out and let go over one of the map's
// cards links to that card's highlight, as it would over the highlight
// on the page — so the map, with its notepad over it, is somewhere to
// gather quotes from as much as the pages are. A bookmark's card links
// to its place on the page. ReaderPane's readerPlaceAt asks here before
// it asks the pages.
import { useBookmarks } from "../lib/bookmarks";
import { annotationByKey, annotationPosition } from "../lib/highlights";
import { useStore } from "../lib/store";
import type { PlaceTarget } from "../pdfviewer/places";

/** What the map card under a client point stands for, when the card is
 *  one of `attKey`'s; null off the map's cards. */
export function mapCardTarget(x: number, y: number, attKey: string): PlaceTarget | null {
  const card = document.elementFromPoint(x, y)?.closest<HTMLElement>(".hlmap-card[data-key]");
  const key = card?.dataset.key;
  if (!key) return null;
  // A bookmark lists as "bookmark:<id>" (lib/bookmarks.ts).
  if (key.startsWith("bookmark:")) {
    const id = key.slice("bookmark:".length);
    const b = useBookmarks.getState().list.find((m) => m.id === id && m.attKey === attKey);
    return b ? { kind: "place", pageIndex: b.pageIndex, top: b.top } : null;
  }
  const a = annotationByKey(useStore.getState().library.items, key);
  const pageIndex = a ? annotationPosition(a)?.pageIndex : undefined;
  if (!a || a.attKey !== attKey || pageIndex == null) return null;
  return { kind: "annotation", key: a.key, pageIndex, text: a.text, color: a.color };
}
