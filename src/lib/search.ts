// Full-library search built on MiniSearch: indexes every field that matters,
// stays fast for libraries with thousands of entries on an iPad.
import MiniSearch from "minisearch";
import { useMemo } from "react";
import { fullCreatorList, itemTitle, topLevelItems, yearOf } from "./collections";
import type { SearchDates, SearchMode, ZItem } from "./types";

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
    // itemTitle, not data.title: a standalone attachment is often only
    // findable by its filename.
    title: itemTitle(item),
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

/** Fields each narrowed mode searches. "all" passes no restriction, so
 *  MiniSearch uses every indexed field. */
const MODE_FIELDS: Partial<Record<SearchMode, string[]>> = {
  title: ["title"],
  creators: ["creators"],
  publication: ["publication"],
};

function parseYear(v: string): number | null {
  const m = /\d{4}/.exec(v.trim());
  return m ? Number(m[0]) : null;
}

/** A date range isn't a text query, so it skips the index and filters on
 *  the parsed year. Either bound may be blank (open-ended); newest
 *  first, since relevance means nothing here. */
function dateRangeKeys(items: ZItem[], dates: SearchDates): string[] | null {
  const lo = parseYear(dates.from);
  const hi = parseYear(dates.to);
  if (lo === null && hi === null) return null;
  return items
    .map((i) => ({ item: i, year: Number(yearOf(i)) }))
    .filter(
      ({ year }) =>
        Boolean(year) &&
        (lo === null || year >= lo) &&
        (hi === null || year <= hi),
    )
    .sort(
      (a, b) =>
        b.year - a.year || itemTitle(a.item).localeCompare(itemTitle(b.item)),
    )
    .map(({ item }) => item.key);
}

/** Returns matching item keys ordered by relevance, or null when not searching. */
export function useSearchResults(
  items: ZItem[],
  query: string,
  mode: SearchMode,
  dates: SearchDates,
): string[] | null {
  const index = useMemo(() => buildIndex(items), [items]);
  const tops = useMemo(() => topLevelItems(items), [items]);
  const { from, to } = dates;
  return useMemo(() => {
    if (mode === "date") return dateRangeKeys(tops, { from, to });
    const q = query.trim();
    if (!q) return null;
    const fields = MODE_FIELDS[mode];
    return index
      .search(q, fields ? { fields } : {})
      .map((r) => String(r.id));
  }, [index, tops, query, mode, from, to]);
}
