// Showing and hiding the side panels — the toolbar's panel buttons and
// their keyboard shortcuts. Narrow windows slide the panels in as
// drawers; wide ones fold them out of the row.
import { useStore } from "./store";

/** The width at which the side panels turn into drawers (base.css). */
export const isNarrow = () => window.matchMedia("(max-width: 900px)").matches;
/** …except the notes beside an open PDF, which stay in the row on a
 *  tablet (notes.css). */
const notesInRow = () => window.matchMedia("(min-width: 600px)").matches;
/** Does the right panel live in the row (rather than in a drawer)? */
const metaInRow = () => !isNarrow() || (Boolean(useStore.getState().reading) && notesInRow());

export function toggleSidebar(): void {
  const s = useStore.getState();
  if (isNarrow()) s.setSidebarOpen(!s.sidebarOpen);
  else s.setSidebarHidden(!s.sidebarHidden);
}

export function toggleMeta(): void {
  const s = useStore.getState();
  if (metaInRow()) s.setMetaHidden(!s.metaHidden);
  else s.setMetaOpen(!s.metaOpen);
}

/** Bring the right panel into view, wherever it lives. */
export function showMeta(): void {
  const s = useStore.getState();
  if (metaInRow()) s.setMetaHidden(false);
  else s.setMetaOpen(true);
}
