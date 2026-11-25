// Turning a folder, a selection, or a single entry into the block of
// text a conversation is grounded in.
//
// Two depths. "Abstracts" is free and instant — it's metadata the app
// already holds. "Full papers" downloads each PDF from Zotero and runs
// it through the same LiteParse parser Get Abstract uses, so what the
// model receives is text, never a PDF: the papers stay Zotero's, and
// the provider is only ever sent the words.
//
// This is the one place the chat feature touches Zotero at all.
import {
  creatorSummary,
  fullCreatorList,
  itemsForCollection,
  itemTitle,
  pdfAttachmentOf,
  REAL_KEY,
  yearOf,
} from "../collections";
import { scheduleTrayClear } from "../../components/TaskTray";
import { RECENT } from "../recent";
import { appLog, useStore } from "../store";
import { invoke } from "../tauri";
import type {
  AskDepth,
  AskGap,
  AskTarget,
  ChatSource,
  PageSpan,
  PendingAsk,
  ZCollection,
  ZItem,
} from "../types";
import { label } from "./index";

/** The caps on a work's text, a guard against a book-length PDF quietly
 *  turning one question into a very expensive one: 120,000 characters
 *  of parsed text is roughly 30K tokens. A work they cut says so, and
 *  which pages went (`ChatSource.cut`); the cost popup can lift them,
 *  and the explainer keeps them. A part of a PDF (Ask PDF's section or
 *  pages, an explainer's) is held to the characters alone. */
export const TEXT_CAPS = { pages: 80, chars: 120_000 };

interface Gathered {
  context: string;
  missing: string[];
  /** Works the caps cut, and the pages of each that went. */
  cut: { title: string; sent: string }[];
}

/** Metadata header every work gets, whichever depth was asked for (and
 *  an explainer's work, asked with its context — explain.ts). */
export function heading(item: ZItem, n: number): string {
  const bits = [
    `## ${n}. ${itemTitle(item)}`,
    `- Authors: ${fullCreatorList(item) || creatorSummary(item) || "unknown"}`,
  ];
  const year = yearOf(item);
  if (year) bits.push(`- Year: ${year}`);
  const pub = String(item.data?.publicationTitle ?? "").trim();
  if (pub) bits.push(`- Publication: ${pub}`);
  const doi = String(item.data?.DOI ?? "").trim();
  if (doi) bits.push(`- DOI: ${doi}`);
  return bits.join("\n");
}

function gatherAbstracts(items: ZItem[]): Gathered {
  const missing: string[] = [];
  const sections: string[] = [];
  items.forEach((item, i) => {
    const abstract = String(item.data?.abstractNote ?? "").trim();
    if (!abstract) {
      missing.push(itemTitle(item));
      // Still list it: "this work is in scope but has no abstract" is
      // information the model should have, not a silent omission.
      sections.push(`${heading(item, i + 1)}\n\n_No abstract on record._`);
      return;
    }
    sections.push(`${heading(item, i + 1)}\n\n${abstract}`);
  });
  return {
    context: `# Works (abstracts)\n\n${sections.join("\n\n---\n\n")}\n`,
    missing,
    cut: [],
  };
}

/** What a chat's full text covers, for the lines under its title and
 *  the cost popup: "full text", or the part of the PDF asked about —
 *  and, where the caps cut it, how much went: "full text, pp. 1–37 of
 *  212 sent", or for several works how many were cut. */
export function depthLabel(source: Pick<ChatSource, "depth" | "pages" | "cut" | "itemKeys">): string {
  if (source.depth !== "full") return "abstracts";
  const base = source.pages ? source.pages.label : "full text";
  const cut = source.cut ?? [];
  if (!cut.length) return base;
  return source.itemKeys.length === 1 ? `${base}, ${cut[0].sent} sent` : `${base}, ${cut.length} cut short`;
}

/** `pages`: only that part of the PDF (Ask PDF, one work). `uncapped`:
 *  every page, past the caps (lib/pdfText.ts). */
async function gatherFullText(items: ZItem[], pages?: PageSpan, uncapped = false): Promise<Gathered> {
  const store = useStore.getState();
  store.startUiTasks(
    "Read papers",
    items.map((i) => ({ id: i.key, title: label(i) })),
  );
  const task = (
    id: string,
    status: "working" | "done" | "error",
    note?: string,
  ) => useStore.getState().updateUiTask(id, { status, note });

  const missing: string[] = [];
  const sections: string[] = [];
  const cut: Gathered["cut"] = [];
  try {
    for (const [i, item] of items.entries()) {
      const head = heading(item, i + 1);
      task(item.key, "working");
      const att = pdfAttachmentOf(useStore.getState().library.items, item.key);
      if (!att) {
        const abstract = String(item.data?.abstractNote ?? "").trim();
        missing.push(itemTitle(item));
        sections.push(
          abstract
            ? `${head}\n\n_No PDF in Zotero — abstract only._\n\n${abstract}`
            : `${head}\n\n_No PDF in Zotero and no abstract on record._`,
        );
        task(item.key, "done", abstract ? "abstract only" : "nothing to read");
        continue;
      }
      try {
        appLog("info", `Ask: reading the PDF of “${label(item)}”…`);
        const [{ extractFullText, extractPageSpan, sentPages }, bytes] = await Promise.all([
          import("../pdfText"),
          invoke<ArrayBuffer>("download_attachment_file", { attKey: att.key }),
        ]);
        const read = pages
          ? await extractPageSpan(bytes, pages.from, pages.to, uncapped ? null : TEXT_CAPS.chars)
          : await extractFullText(bytes, uncapped ? null : TEXT_CAPS);
        const { text, truncated } = read;
        if (!text.trim()) {
          missing.push(itemTitle(item));
          sections.push(
            `${head}\n\n_The PDF yielded no text (it is probably a scan)._`,
          );
          task(item.key, "done", "no text in PDF");
          continue;
        }
        // A part of the work says which part, so the model doesn't take
        // it for the whole — and so does a work the caps cut, saying
        // exactly which pages it has.
        const part = pages ? `\n- Only part of this work is included: ${pages.label}` : "";
        const sent = sentPages(read);
        if (truncated) cut.push({ title: itemTitle(item), sent });
        const note = truncated
          ? `\n- Note: the text below is cut short; only ${sent} are included`
          : "";
        sections.push(`${head}${part}${note}\n\n${text}`);
        task(item.key, "done", truncated ? `${sent}, cut short` : `${Math.round(text.length / 1000)}K chars`);
      } catch (e) {
        appLog("warn", `Ask: could not read “${label(item)}” (${e})`);
        missing.push(itemTitle(item));
        sections.push(`${head}\n\n_The PDF could not be read._`);
        task(item.key, "error", String(e).slice(0, 80));
      }
    }
  } finally {
    scheduleTrayClear();
  }
  return {
    context: `# Works (full text)\n\n${sections.join("\n\n---\n\n")}\n`,
    missing,
    cut,
  };
}

/** The items a request covers, resolved fresh each time so a retrieval
 *  between the popup opening and the request running is picked up. */
export function itemsForAsk(target: AskTarget): ZItem[] {
  const all = useStore.getState().library.items;
  if (target.kind === "folder") {
    return itemsForCollection(all, target.collectionKey);
  }
  const byKey = new Map(all.map((i) => [i.key, i]));
  return target.keys
    .map((k) => byKey.get(k))
    .filter((i): i is ZItem => i !== undefined && !i.data?.parentItem);
}

/** What the AI menu's two Ask entries point at: the selection when
 *  there is one, the open folder when there isn't. */
export function askTargetFor(
  items: ZItem[],
  collections: ZCollection[],
  collectionKey: string,
  selectedKeys: string[],
): AskTarget {
  if (selectedKeys.length === 1) {
    const item = items.find((i) => i.key === selectedKeys[0]);
    return {
      kind: "item",
      keys: selectedKeys,
      collectionKey,
      label: item ? itemTitle(item) : "One item",
      count: item ? 1 : 0,
    };
  }
  if (selectedKeys.length > 1) {
    return {
      kind: "selection",
      keys: selectedKeys,
      collectionKey,
      label: `${selectedKeys.length} selected items`,
      count: selectedKeys.length,
    };
  }
  const name =
    collectionKey === "all"
      ? "All Items"
      : collectionKey === "unfiled"
        ? "Unfiled"
        : collectionKey === RECENT
          ? "Recent"
          : String(
            collections.find((c) => c.key === collectionKey)?.data?.name ??
              "This folder",
          );
  return {
    kind: "folder",
    keys: [],
    collectionKey,
    label: name,
    count: itemsForCollection(items, collectionKey).length,
  };
}

/** Works this depth has nothing to read for, checked before anything is
 *  gathered so the popup can offer to go and get them. An abstract can
 *  be lifted out of a PDF, so a missing abstract is only fixable where
 *  there is one; a missing PDF is always worth a try. */
export function askGaps(items: ZItem[], depth: AskDepth): AskGap[] {
  const all = useStore.getState().library.items;
  const gaps: AskGap[] = [];
  for (const item of items) {
    const hasPdf = Boolean(pdfAttachmentOf(all, item.key));
    if (depth === "full") {
      if (!hasPdf) gaps.push({ key: item.key, title: itemTitle(item), fixable: true });
      continue;
    }
    if (!String(item.data?.abstractNote ?? "").trim()) {
      gaps.push({ key: item.key, title: itemTitle(item), fixable: hasPdf });
    }
  }
  return gaps;
}

/** Read the works and price the request, ready for the confirmation
 *  popup. Nothing has been sent to a provider at this point — the token
 *  count on Anthropic is a free counting call, and on OpenAI (which has
 *  no counting endpoint) an approximation. */
export async function prepareAsk(
  target: AskTarget,
  items: ZItem[],
  depth: AskDepth,
  pages?: PageSpan,
  uncapped = false,
): Promise<PendingAsk> {
  // A part of a PDF is one work's; anywhere else it means nothing.
  if (depth !== "full" || items.length !== 1) pages = undefined;
  const settings = useStore.getState().settings;
  if (!settings) throw new Error("Settings are not loaded yet");
  const gaps = askGaps(items, depth);
  appLog(
    "info",
    `Ask ${pages ? `PDF (${pages.label})` : depth === "full" ? "Full Papers" : "Abstracts"}: gathering ${items.length} work(s)…`,
  );
  const { context, missing, cut } =
    depth === "full" ? await gatherFullText(items, pages, uncapped) : gatherAbstracts(items);

  const count = await invoke<{
    tokens: number;
    exact: boolean;
    model: string;
    service: string;
  }>("ai_count_tokens", { context, messages: [] });

  return {
    target,
    source: {
      kind: target.kind,
      itemKeys: items.map((i) => i.key),
      itemTitles: items.map(itemTitle),
      // "all" and "unfiled" are views, not collections Zotero can be
      // pointed at, so they're left off.
      collectionKey: REAL_KEY.test(target.collectionKey)
        ? target.collectionKey
        : undefined,
      label: target.label,
      depth,
      ...(pages ? { pages } : {}),
      missing,
      ...(cut.length ? { cut } : {}),
      ...(uncapped && depth === "full" ? { uncapped } : {}),
    },
    context,
    tokens: count.tokens,
    exact: count.exact,
    service: count.service === "openai" ? "openai" : "anthropic",
    model: count.model,
    gaps,
  };
}
