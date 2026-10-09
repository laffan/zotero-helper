// The PDF's own outline (its bookmarks, usually a table of contents),
// resolved to places in the pages: each entry's page and, when its
// destination names one, the height on that page the heading sits at.
// The outline panel navigates by it, and the Highlights tab files
// highlights under the headings it names (lib/outline.ts).
import type { PDFDocumentProxy } from "./types";

export interface OutlineEntry {
  title: string;
  /** 0-based page, or null when the destination can't be resolved
   *  (a web link, a broken reference). */
  pageIndex: number | null;
  /** The destination's top in PDF user space (y up from the page's
   *  bottom), or null for "the top of the page". */
  top: number | null;
  children: OutlineEntry[];
}

/** Book outlines run to a few hundred entries; a pathological file
 *  shouldn't stall the viewer resolving tens of thousands. */
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 10;

type RawNode = { title: string; dest: string | unknown[] | null; items: RawNode[] };

async function resolve(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<{ pageIndex: number | null; top: number | null }> {
  const none = { pageIndex: null, top: null };
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit[0] == null) return none;
    const ref = explicit[0];
    // Usually a page reference; some files give the page index itself.
    const pageIndex =
      typeof ref === "number"
        ? ref
        : typeof ref === "object"
          ? await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])
          : null;
    if (pageIndex == null || pageIndex < 0 || pageIndex >= doc.numPages) return none;
    // [page, /XYZ, left, top, zoom] · [page, /FitH, top] ·
    // [page, /FitR, left, bottom, right, top]
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    const raw =
      kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : kind === "FitR" ? explicit[5] : null;
    return { pageIndex, top: typeof raw === "number" && Number.isFinite(raw) ? raw : null };
  } catch {
    return none;
  }
}

/** The document's outline, resolved; empty when it has none. */
export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const raw = ((await doc.getOutline().catch(() => null)) ?? []) as RawNode[];
  let budget = MAX_ENTRIES;
  const walk = async (nodes: RawNode[], depth: number): Promise<OutlineEntry[]> => {
    const take = nodes.slice(0, Math.max(0, budget));
    budget -= take.length;
    return Promise.all(
      take.map(async (n) => ({
        title: String(n.title ?? "").replace(/\s+/g, " ").trim() || "(untitled)",
        ...(await resolve(doc, n.dest)),
        children: depth < MAX_DEPTH && n.items?.length ? await walk(n.items, depth + 1) : [],
      })),
    );
  };
  return walk(raw, 0);
}
