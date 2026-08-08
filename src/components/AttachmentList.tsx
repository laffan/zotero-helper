// Attachments of the selected item, at the foot of the metadata panel.
// Zotero allows any number per item; each row shares its own file.
import { useRef } from "react";
import { attachmentName, attachmentsOf } from "../lib/collections";
import { shareAttachment } from "../lib/share";
import { useStore } from "../lib/store";
import { PdfIcon, ShareIcon } from "./Icons";

export function AttachmentList({ itemKey }: { itemKey: string }) {
  const items = useStore((s) => s.library.items);
  const rowsRef = useRef<HTMLDivElement>(null);
  const attachments = attachmentsOf(items, itemKey);
  if (attachments.length === 0) return null;

  const share = (attKey: string, name: string) => {
    const r = rowsRef.current?.getBoundingClientRect();
    void shareAttachment(
      attKey,
      name,
      r
        ? { x: r.right - 20, y: r.top }
        : { x: window.innerWidth / 2, y: 60 },
    );
  };

  return (
    <div className="meta-field attachment-list" ref={rowsRef}>
      <span>Attachments ({attachments.length})</span>
      {attachments.map((att) => {
        const name = attachmentName(att);
        const isPdf =
          att.data?.contentType === "application/pdf" ||
          name.toLowerCase().endsWith(".pdf");
        return (
          <div className="attachment-row" key={att.key}>
            {isPdf && <PdfIcon size={12} />}
            <span className="attachment-name" title={name}>
              {name}
            </span>
            <button
              className="icon-btn"
              onClick={() => share(att.key, name)}
              aria-label={`Share ${name}`}
              title="Share this file"
            >
              <ShareIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
