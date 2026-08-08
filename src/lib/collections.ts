import type { ZCollection, ZItem } from "./types";

export interface CollectionNode {
  key: string;
  name: string;
  version: number;
  children: CollectionNode[];
}

export function buildTree(collections: ZCollection[]): CollectionNode[] {
  const nodes = new Map<string, CollectionNode>();
  for (const c of collections) {
    nodes.set(c.key, {
      key: c.key,
      name: c.data?.name ?? "(untitled)",
      version: c.version ?? c.data?.version ?? 0,
      children: [],
    });
  }
  const roots: CollectionNode[] = [];
  for (const c of collections) {
    const node = nodes.get(c.key)!;
    const parent = c.data?.parentCollection;
    if (parent && typeof parent === "string" && nodes.has(parent)) {
      nodes.get(parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: CollectionNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** "Grandparent / Parent / Folder" for every collection. The flagged
 *  list in the sidebar is flat, where a bare folder name ("Drafts",
 *  "2024") is often ambiguous — this is what its tooltip shows. */
export function collectionPaths(
  collections: ZCollection[],
): Map<string, string> {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const paths = new Map<string, string>();
  for (const c of collections) {
    const parts: string[] = [];
    let cur: ZCollection | undefined = c;
    // Depth cap: a malformed parent chain must not spin forever.
    for (let i = 0; cur && i < 32; i++) {
      parts.unshift(String(cur.data?.name ?? "(untitled)"));
      const parent: unknown = cur.data?.parentCollection;
      cur = typeof parent === "string" ? byKey.get(parent) : undefined;
    }
    paths.set(c.key, parts.join(" / "));
  }
  return paths;
}

/** Top-level (non-child) items only. */
export function topLevelItems(items: ZItem[]): ZItem[] {
  return items.filter((i) => !i.data?.parentItem);
}

export function itemsForCollection(items: ZItem[], key: string): ZItem[] {
  const tops = topLevelItems(items);
  if (key === "all") return tops;
  if (key === "unfiled")
    return tops.filter((i) => !i.data?.collections?.length);
  return tops.filter((i) => i.data?.collections?.includes(key));
}

/** Real Zotero object keys are 8 alphanumerics — this excludes the local
 *  `…-att-local` placeholder rows created mid-import. */
export const REAL_KEY = /^[A-Z0-9]{8}$/i;

/** The item's synced PDF attachment, if it has one. */
export function pdfAttachmentOf(
  items: ZItem[],
  parentKey: string,
): ZItem | undefined {
  return items.find(
    (a) =>
      a.data?.parentItem === parentKey &&
      a.data?.itemType === "attachment" &&
      REAL_KEY.test(a.key) &&
      (a.data?.contentType === "application/pdf" ||
        String(a.data?.filename ?? "")
          .toLowerCase()
          .endsWith(".pdf")),
  );
}

/** parentItem key -> its first PDF attachment key. Built once per
 *  library change so grid cells don't each scan every item. */
export function pdfAttachmentMap(items: ZItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of items) {
    const d = a.data;
    if (
      !d?.parentItem ||
      d.itemType !== "attachment" ||
      !REAL_KEY.test(a.key) ||
      map.has(d.parentItem)
    ) {
      continue;
    }
    if (
      d.contentType === "application/pdf" ||
      String(d.filename ?? "").toLowerCase().endsWith(".pdf")
    ) {
      map.set(d.parentItem, a.key);
    }
  }
  return map;
}

/** Every synced attachment of an item, in library order. */
export function attachmentsOf(items: ZItem[], parentKey: string): ZItem[] {
  return items.filter(
    (a) =>
      a.data?.parentItem === parentKey &&
      a.data?.itemType === "attachment" &&
      REAL_KEY.test(a.key),
  );
}

/** Display name for an attachment row. */
export function attachmentName(att: ZItem): string {
  const f = String(att.data?.filename ?? "").trim();
  if (f) return f;
  const t = String(att.data?.title ?? "").trim();
  return t || att.key;
}

/** Map of parentItem key -> true when a PDF attachment exists. */
export function pdfMap(items: ZItem[]): Set<string> {
  const set = new Set<string>();
  for (const i of items) {
    const d = i.data;
    if (
      d?.parentItem &&
      d.itemType === "attachment" &&
      (d.contentType === "application/pdf" ||
        (d.filename ?? "").toLowerCase().endsWith(".pdf"))
    ) {
      set.add(d.parentItem);
    }
  }
  return set;
}

export function creatorSummary(item: ZItem): string {
  if (item.meta?.creatorSummary) return item.meta.creatorSummary;
  const creators = item.data?.creators ?? [];
  const names = creators
    .filter((c) => c.creatorType === "author" || creators.length === 1)
    .map((c) => c.lastName || c.name || "")
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} et al.`;
}

export function yearOf(item: ZItem): string {
  const d = item.meta?.parsedDate ?? item.data?.date ?? "";
  const m = /\d{4}/.exec(String(d));
  return m ? m[0] : "";
}

export function fullCreatorList(item: ZItem): string {
  const creators = item.data?.creators ?? [];
  return creators
    .map((c) =>
      c.name ? c.name : [c.firstName, c.lastName].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(", ");
}
