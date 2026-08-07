// "Send to Hush" — builds hushwriter://zotero-import deep links for the
// Hush companion app. Hush downloads the PDFs itself from the Zotero API
// with its own credentials, so the link carries only item/attachment
// keys and display metadata (never secrets). Contract mirrored in Hush's
// src/links/zotero-helper-import.js.
import { fullCreatorList, pdfAttachmentOf, yearOf } from "./collections";
import { appLog } from "./store";
import { invoke } from "./tauri";
import type { ZItem } from "./types";

export interface HushProject {
  id: string;
  name: string;
}

export interface HushDesk {
  id: string;
  name: string;
  projects: HushProject[];
}

export interface HushSendable {
  itemKey: string;
  attKey: string;
  title: string;
  authors: string;
  firstAuthor: string;
  year: string;
  citekey: string;
}

export interface HushSelectionSplit {
  ready: HushSendable[];
  skipped: { item: ZItem; reason: string }[];
}

/** Split the current selection into items Hush can fetch (they have a
 *  synced PDF attachment) and items to skip, with a reason each. */
export function analyzeSelection(
  items: ZItem[],
  selectedKeys: string[],
): HushSelectionSplit {
  const ready: HushSendable[] = [];
  const skipped: HushSelectionSplit["skipped"] = [];
  const selected = items.filter(
    (i) => selectedKeys.includes(i.key) && !i.data?.parentItem,
  );
  for (const item of selected) {
    const att = pdfAttachmentOf(items, item.key);
    if (!att) {
      const pendingLocal = items.some(
        (a) => a.data?.parentItem === item.key && a.key.endsWith("-att-local"),
      );
      skipped.push({
        item,
        reason: pendingLocal
          ? "PDF just uploaded — run Sync so it gets a real key"
          : "no PDF attachment in Zotero",
      });
      continue;
    }
    const creators = item.data?.creators ?? [];
    const first =
      creators.find((c) => c.creatorType === "author") ?? creators[0];
    ready.push({
      itemKey: item.key,
      attKey: att.key,
      title: String(item.data?.title ?? "Untitled"),
      authors: fullCreatorList(item),
      firstAuthor: first ? first.lastName || first.name || "" : "",
      year: yearOf(item),
      citekey: "",
    });
  }
  return { ready, skipped };
}

/** Desk/project roster read from the local Hush install; empty when Hush
 *  isn't present (or on iPadOS, where sandboxing hides it) — the picker
 *  then falls back to free-text names. */
export async function listHushDesks(): Promise<HushDesk[]> {
  try {
    return await invoke<HushDesk[]>("list_hush_desks");
  } catch (e) {
    appLog("debug", `Hush desk roster unavailable: ${e}`);
    return [];
  }
}

/** Keep deep-link URLs comfortably inside OS limits. */
const CHUNK_SIZE = 8;

export async function sendToHush(
  items: HushSendable[],
  desk: string,
  project: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const params = new URLSearchParams();
    if (desk) params.set("desk", desk);
    if (project) params.set("project", project);
    params.set("items", JSON.stringify(chunk));
    await invoke("open_in_hush", {
      url: `hushwriter://zotero-import?${params.toString()}`,
    });
    // Give Hush a beat to process before the next chunk arrives.
    if (i + CHUNK_SIZE < items.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  const target = desk
    ? ` → ${desk}${project ? ` / ${project}` : ""}`
    : " → active desk";
  appLog("info", `Sent ${items.length} item(s) to Hush${target}`);
}
