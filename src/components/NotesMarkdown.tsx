// NOTES.md rendered for reading. Page references are zotero://open-pdf
// links; while Take Notes has that PDF open they move the viewer there,
// and otherwise they open the PDF in Zotero at that spot.
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openInZotero } from "../lib/actions";
import { parsePdfLink } from "../lib/highlights";
import { showInReader } from "./ReaderPane";

function follow(itemKey: string, href: string): void {
  const link = parsePdfLink(href);
  if (link) {
    if (!showInReader(link.attKey, link.page, link.annotation)) {
      void openInZotero(itemKey, link.attKey, undefined, link.page, link.annotation);
    }
    return;
  }
  if (/^https?:\/\//i.test(href)) void openUrl(href).catch(() => window.open(href, "_blank"));
}

export function NotesMarkdown({ itemKey, text }: { itemKey: string; text: string }) {
  return (
    <div className="notes-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        // react-markdown drops schemes it doesn't know; let Zotero's
        // through and leave everything else to the default sanitizer.
        urlTransform={(url) => (url.startsWith("zotero://") ? url : defaultUrlTransform(url))}
        components={{
          table: ({ children }) => (
            <div className="notes-md-table">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                follow(itemKey, String(href ?? ""));
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
