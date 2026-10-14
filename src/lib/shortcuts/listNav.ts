// The item list from the keyboard: the arrows move the selection
// through the list (or the icon grid, by rows and columns), ⇧ with them
// extends it, and Return opens the item — as a double-click does.
//
// The list is virtualized, so it registers what keyboard moves need —
// its order, how to scroll a row into view, how to open one — and the
// icon grid adds its column count.
import { useEffect } from "react";
import { useStore } from "../store";

interface ListSource {
  /** The keys in the order shown. */
  keys: string[];
  open: (key: string) => void;
  /** Scroll the item at this index into view. */
  reveal: (index: number) => void;
  /** Items to a row: the grid's column count, or 1. */
  columns: () => number;
}

let source: ListSource | null = null;
/** The end of the selection that moves, and the end that stays. */
let cursorKey: string | null = null;
let anchorKey: string | null = null;

/** Register the list on screen (ItemList), for as long as it is. */
export function useListNav(src: ListSource): void {
  useEffect(() => {
    source = src;
    return () => {
      if (source === src) source = null;
    };
  });
}

/** The icon grid's shape, kept current by IconGrid. */
export const gridNav = {
  cols: 1,
  reveal: (_index: number) => {},
};

/** Move the selection by `delta` items — a row is `columns()` items. */
export function moveSelection(delta: number, extend = false, byRow = false): void {
  if (!source || !source.keys.length) return;
  const { keys } = source;
  // A list's rows have no left and right.
  if (!byRow && source.columns() === 1) return;
  const step = byRow ? delta * source.columns() : delta;
  const { selectedKeys, setSelectedKeys } = useStore.getState();
  const cursor = cursorKey && selectedKeys.includes(cursorKey) ? cursorKey : selectedKeys[selectedKeys.length - 1];
  const from = cursor ? keys.indexOf(cursor) : -1;
  const to = from < 0 ? (step > 0 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, from + step));
  if (extend && cursor && from >= 0) {
    const anchor = anchorKey && selectedKeys.includes(anchorKey) ? anchorKey : cursor;
    const a = keys.indexOf(anchor);
    const [lo, hi] = a < to ? [a, to] : [to, a];
    anchorKey = anchor;
    setSelectedKeys(keys.slice(lo, hi + 1));
  } else {
    anchorKey = keys[to];
    setSelectedKeys([keys[to]]);
  }
  cursorKey = keys[to];
  source.reveal(to);
}

/** Open the selected item (the one the cursor is on, of several). */
export function openSelection(): void {
  const { selectedKeys } = useStore.getState();
  const key = cursorKey && selectedKeys.includes(cursorKey) ? cursorKey : selectedKeys[0];
  if (source && key) source.open(key);
}
