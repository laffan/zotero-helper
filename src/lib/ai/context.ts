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
  yearOf,
} from "../collections";
import { scheduleTrayClear } from "../../components/TaskTray";
import { appLog, useStore } from "../store";
import { invoke } from "../tauri";
import type {
  AskDepth,
  AskGap,
  AskTarget,
  PendingAsk,
  ZCollection,
  ZItem,
} from "../types";
import { label } from "./index";

interface Gathered {
  context: string;
  missing: string[];
}

/** Metadata header every work gets, whichever depth was asked for. */
function heading(item: ZItem, n: number): string {
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
  };
}

async function gatherFullText(items: ZItem[]): Promise<Gathered> {
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
        const [{ extractFullText }, bytes] = await Promise.all([
          import("../pdfText"),
          invoke<ArrayBuffer>("download_attachment_file", { attKey: att.key }),
        ]);
        const { text, truncated } = await extractFullText(bytes);
        if (!text.trim()) {
          missing.push(itemTitle(item));
          sections.push(
            `${head}\n\n_The PDF yielded no text (it is probably a scan)._`,
          );
          task(item.key, "done", "no text in PDF");
          continue;
        }
        sections.push(
          `${head}${truncated ? "\n- Note: long work, text below is cut short" : ""}\n\n${text}`,
        );
        task(item.key, "done", `${Math.round(text.length / 1000)}K chars`);
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
): Promise<PendingAsk> {
  const settings = useStore.getState().settings;
  if (!settings) throw new Error("Settings are not loaded yet");
  const gaps = askGaps(items, depth);
  appLog(
    "info",
    `Ask ${depth === "full" ? "Full Papers" : "Abstracts"}: gathering ${items.length} work(s)…`,
  );
  const { context, missing } =
    depth === "full" ? await gatherFullText(items) : gatherAbstracts(items);

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
      label: target.label,
      depth,
      missing,
    },
    context,
    tokens: count.tokens,
    exact: count.exact,
    service: count.service === "openai" ? "openai" : "anthropic",
    model: count.model,
    gaps,
  };
}
