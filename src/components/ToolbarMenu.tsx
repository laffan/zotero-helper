// The dropdown used by every toolbar control (Sync, AI, Share, search
// modes).
//
// It renders into document.body on purpose: the toolbar scrolls
// horizontally (`overflow-x: auto`), and any overflow value clips
// absolutely-positioned children — the menu would vanish under the item
// list. Fixed positioning from the anchor's rect escapes that.
import { createPortal } from "react-dom";

export function ToolbarMenu({
  anchorRef,
  width = 250,
  children,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  /** Menu width in px; also what keeps it on-screen near the edge. */
  width?: number;
  children: React.ReactNode;
}) {
  const r = anchorRef.current?.getBoundingClientRect();
  if (!r) return null;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  return createPortal(
    <div
      className="filter-pop sync-menu"
      style={{ position: "fixed", top: r.bottom + 4, left, right: "auto", width }}
    >
      {children}
    </div>,
    document.body,
  );
}
