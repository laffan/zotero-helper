// "Share" toolbar actions. Files are staged in the app temp dir by the
// Rust core, then handed to the iOS share sheet (via the share-sheet
// plugin, anchored at the Share button) — or, on desktop, exported
// through save/folder dialogs.
import { creatorSummary, itemTitle, pdfAttachmentOf, yearOf } from "./collections";
import { scheduleTrayClear } from "../components/TaskTray";
import { appLog, useStore } from "./store";
import { invoke } from "./tauri";
import type { ZItem } from "./types";

const isIpad = () => document.documentElement.classList.contains("ipados");

/** Share the selected items' PDFs. `anchor` is the Share button's
 *  viewport position (the iPad share popover points at it). */
export async function sharePdfs(
  keys: string[],
  anchor: { x: number; y: number },
): Promise<void> {
  const items = selectedItems(keys);
  const withPdf = items
    .map((item) => ({ item, att: pdfAttachmentOf(allItems(), item.key) }))
    .filter((p): p is { item: ZItem; att: ZItem } => Boolean(p.att));
  if (withPdf.length === 0) {
    appLog("warn", "Share PDFs: none of the selected items has a PDF");
    return;
  }
  if (withPdf.length < items.length) {
    appLog(
      "info",
      `Share PDFs: ${items.length - withPdf.length} item(s) skipped (no PDF)`,
    );
  }

  const store = useStore.getState();
  store.startUiTasks(
    "Share PDFs",
    withPdf.map(({ item }) => ({ id: item.key, title: label(item) })),
  );
  const paths: string[] = [];
  try {
    for (const { item, att } of withPdf) {
      try {
        store.updateUiTask(item.key, { status: "working" });
        appLog("info", `Share PDFs: fetching “${label(item)}”…`);
        const path = await invoke<string>("stage_attachment_for_share", {
          attKey: att.key,
          fileName: pdfFileName(item, att),
        });
        paths.push(path);
        store.updateUiTask(item.key, { status: "done" });
      } catch (e) {
        appLog("error", `Share PDFs: “${label(item)}” failed: ${e}`);
        store.updateUiTask(item.key, {
          status: "error",
          note: String(e).slice(0, 80),
        });
      }
    }
  } finally {
    scheduleTrayClear();
  }
  if (paths.length === 0) return;
  await presentShare(paths, anchor, `${paths.length} PDF(s)`);
}

/** Share titles (linked to their Zotero entries) + abstracts as a
 *  markdown document. */
export async function shareAbstracts(
  keys: string[],
  anchor: { x: number; y: number },
): Promise<void> {
  const items = selectedItems(keys);
  if (items.length === 0) return;

  const sections = items.map((item) => {
    const title = String(item.data?.title ?? "Untitled");
    const line = `## [${title.replace(/([\[\]])/g, "\\$1")}](${zoteroSelectUrl(item.key)})`;
    const byline = [creatorSummary(item), yearOf(item)]
      .filter(Boolean)
      .join(", ");
    const abstract = String(item.data?.abstractNote ?? "").trim();
    return [
      line,
      byline ? `*${byline}*` : "",
      "",
      abstract || "_No abstract._",
    ]
      .filter((s, i) => s !== "" || i === 2)
      .join("\n");
  });
  const md = `# Abstracts\n\n${sections.join("\n\n")}\n`;

  try {
    const path = await invoke<string>("stage_text_for_share", {
      fileName: "Abstracts.md",
      content: md,
    });
    await presentShare([path], anchor, "abstracts");
  } catch (e) {
    appLog("error", `Share abstracts failed: ${e}`);
  }
}

/** Share one attachment straight from the metadata panel. */
export async function shareAttachment(
  attKey: string,
  fileName: string,
  anchor: { x: number; y: number },
): Promise<void> {
  try {
    appLog("info", `Share: fetching “${fileName}”…`);
    const path = await invoke<string>("stage_attachment_for_share", {
      attKey,
      fileName,
    });
    await presentShare([path], anchor, fileName);
  } catch (e) {
    appLog("error", `Share “${fileName}” failed: ${e}`);
  }
}

/** Share the multi-select summary exactly as the panel shows it: the
 *  chosen fields, in order, per item. */
export async function shareSummary(
  items: ZItem[],
  fields: { id: string; label: string }[],
  valueOf: (item: ZItem, fieldId: string) => string,
  anchor: { x: number; y: number },
): Promise<void> {
  if (items.length === 0) return;
  const sections = items.map((item) => {
    const lines: string[] = [];
    for (const f of fields) {
      const v = valueOf(item, f.id).trim();
      if (!v) continue;
      if (f.id === "title") {
        lines.push(`## [${mdEscape(v)}](${zoteroSelectUrl(item.key)})`, "");
      } else if (f.id === "url") {
        lines.push(`**${f.label}:** <${v}>`);
      } else if (f.id === "abstractShort" || f.id === "abstractNote") {
        // "Abbreviated" is a panel-side nicety only: an exported
        // document always carries the whole abstract.
        lines.push("", String(item.data?.abstractNote ?? "").trim() || v);
      } else {
        lines.push(`**${f.label}:** ${v}`);
      }
    }
    // No title field selected? Still anchor the entry on something.
    if (!fields.some((f) => f.id === "title")) {
      lines.unshift(
        `## [${mdEscape(String(item.data?.title ?? item.key))}](${zoteroSelectUrl(item.key)})`,
        "",
      );
    }
    return lines.join("\n");
  });
  const md = `# Selected items (${items.length})\n\n${sections.join("\n\n---\n\n")}\n`;
  try {
    const path = await invoke<string>("stage_text_for_share", {
      fileName: "Selection.md",
      content: md,
    });
    await presentShare([path], anchor, "selection");
  } catch (e) {
    appLog("error", `Share selection failed: ${e}`);
  }
}

function mdEscape(s: string): string {
  return s.replace(/([\[\]])/g, "\\$1");
}

/** iOS: system share sheet. Desktop: folder picker (many files) or save
 *  dialog (single file). */
async function presentShare(
  paths: string[],
  anchor: { x: number; y: number },
  what: string,
): Promise<void> {
  if (isIpad()) {
    try {
      await invoke("share_files", { paths, x: anchor.x, y: anchor.y });
      return;
    } catch (e) {
      appLog("error", `Share sheet failed: ${e}`);
      return;
    }
  }
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    if (paths.length === 1) {
      const name = paths[0].split(/[/\\]/).pop() ?? "file";
      const dest = await dialog.save({ defaultPath: name });
      if (!dest) return;
      await invoke("export_file", { src: paths[0], dest });
      appLog("info", `Saved ${what} to ${dest}`);
    } else {
      const dir = await dialog.open({ directory: true, multiple: false });
      if (typeof dir !== "string") return;
      const n = await invoke<number>("export_files", {
        paths,
        destDir: dir,
      });
      appLog("info", `Saved ${n} file(s) to ${dir}`);
    }
  } catch (e) {
    appLog("error", `Export failed: ${e}`);
  }
}

function zoteroSelectUrl(itemKey: string): string {
  const s = useStore.getState().settings;
  return s?.libraryType === "group"
    ? `zotero://select/groups/${s.zoteroUserId}/items/${itemKey}`
    : `zotero://select/library/items/${itemKey}`;
}

function pdfFileName(item: ZItem, att: ZItem): string {
  const attName = String(att.data?.filename ?? "").trim();
  if (attName) return attName;
  return `${String(item.data?.title ?? item.key).slice(0, 100)}.pdf`;
}

function allItems(): ZItem[] {
  return useStore.getState().library.items;
}

function selectedItems(keys: string[]): ZItem[] {
  return allItems().filter((i) => keys.includes(i.key) && !i.data?.parentItem);
}

function label(item: ZItem): string {
  const t = itemTitle(item);
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
