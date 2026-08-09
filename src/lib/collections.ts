import type { ZCollection, ZItem, ZItemData } from "./types";

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

function isPdfAttachment(d: ZItemData | undefined): boolean {
  return (
    d?.itemType === "attachment" &&
    (d.contentType === "application/pdf" ||
      String(d.filename ?? "")
        .toLowerCase()
        .endsWith(".pdf"))
  );
}

/** Zotero allows a file to live at the top level with no parent entry.
 *  Such a row *is* its own attachment, so anything keyed on "the item's
 *  PDF" has to answer with the item itself. */
export function isStandaloneAttachment(item: ZItem): boolean {
  return item.data?.itemType === "attachment" && !item.data?.parentItem;
}

/** The item's synced PDF attachment, if it has one. */
export function pdfAttachmentOf(
  items: ZItem[],
  parentKey: string,
): ZItem | undefined {
  const self = items.find((i) => i.key === parentKey);
  if (self && isStandaloneAttachment(self)) {
    return isPdfAttachment(self.data) && REAL_KEY.test(self.key)
      ? self
      : undefined;
  }
  return items.find(
    (a) =>
      a.data?.parentItem === parentKey &&
      REAL_KEY.test(a.key) &&
      isPdfAttachment(a.data),
  );
}

/** Item key -> the PDF attachment key to render for it: a child
 *  attachment for normal entries, the row's own key for a standalone
 *  file. Built once per library change so grid cells don't each scan
 *  every item. */
export function pdfAttachmentMap(items: ZItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of items) {
    const d = a.data;
    if (!REAL_KEY.test(a.key) || !isPdfAttachment(d)) continue;
    const owner = d?.parentItem ?? a.key;
    if (!map.has(owner)) map.set(owner, a.key);
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

/** What the item list and grid caption show. Standalone attachments
 *  often carry no title at all, only the filename. */
export function itemTitle(item: ZItem): string {
  const t = String(item.data?.title ?? "").trim();
  if (t) return t;
  const f = String(item.data?.filename ?? "").trim();
  return f || "(untitled)";
}

/** Display name for an attachment row. */
export function attachmentName(att: ZItem): string {
  const f = String(att.data?.filename ?? "").trim();
  if (f) return f;
  const t = String(att.data?.title ?? "").trim();
  return t || att.key;
}

/** Keys of every item that has a PDF — a parent with a PDF child, or a
 *  standalone PDF attachment, which counts as its own. */
export function pdfMap(items: ZItem[]): Set<string> {
  const set = new Set<string>();
  for (const i of items) {
    if (isPdfAttachment(i.data)) set.add(i.data?.parentItem ?? i.key);
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
