// Full-library search built on MiniSearch: indexes every field that matters,
// stays fast for libraries with thousands of entries on an iPad.
import MiniSearch from "minisearch";
import { useMemo } from "react";
import { fullCreatorList, topLevelItems, yearOf } from "./collections";
import type { ZItem } from "./types";

interface SearchDoc {
  key: string;
  title: string;
  creators: string;
  abstract: string;
  publication: string;
  year: string;
  doi: string;
  tags: string;
  itemType: string;
  extra: string;
  [key: string]: string;
}

function toDoc(item: ZItem): SearchDoc {
  const d = item.data ?? ({} as ZItem["data"]);
  return {
    key: item.key,
    title: String(d.title ?? ""),
    creators: fullCreatorList(item),
    abstract: String(d.abstractNote ?? ""),
    publication: String(d.publicationTitle ?? d.bookTitle ?? d.proceedingsTitle ?? ""),
    year: yearOf(item),
    doi: String(d.DOI ?? d.ISBN ?? ""),
    tags: (d.tags ?? []).map((t) => t.tag).join(" "),
    itemType: String(d.itemType ?? ""),
    extra: String(d.extra ?? ""),
  };
}

export function buildIndex(items: ZItem[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    idField: "key",
    fields: [
      "title",
      "creators",
      "abstract",
      "publication",
      "year",
      "doi",
      "tags",
      "itemType",
      "extra",
    ],
    storeFields: ["key"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.15,
      combineWith: "AND",
      boost: { title: 3, creators: 2, tags: 2, doi: 4 },
    },
  });
  ms.addAll(topLevelItems(items).map(toDoc));
  return ms;
}

/** Returns matching item keys ordered by relevance, or null when not searching. */
export function useSearchResults(
  items: ZItem[],
  query: string,
): string[] | null {
  const index = useMemo(() => buildIndex(items), [items]);
  return useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return index.search(q).map((r) => String(r.id));
  }, [index, query]);
}
