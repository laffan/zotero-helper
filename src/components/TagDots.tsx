// Colored-tag swatches. In Zotero a handful of tags can be assigned a
// color (and a 1..9 shortcut key); the *items* only carry tag names, so
// the colors come from the library's `tagColors` setting, fetched by the
// sync engine. Rendered before the title in list view and on the caption's
// second line in icon view.
import { useStore } from "../lib/store";
import type { TagColor, ZItem } from "../lib/types";

/** At most this many swatches per item — beyond four they stop reading
 *  as distinct marks and start eating the title. */
const MAX_DOTS = 4;

/** Name → color/position, rebuilt only when the setting itself changes.
 *  Every visible row calls this, so it must not allocate per row. */
let cachedSource: TagColor[] | null = null;
let cachedMap = new Map<string, { color: string; order: number }>();

function colorMap(list: TagColor[]): Map<string, { color: string; order: number }> {
  if (list !== cachedSource) {
    cachedSource = list;
    cachedMap = new Map(
      list.map((t, i) => [t.name.trim().toLowerCase(), { color: t.color, order: i }]),
    );
  }
  return cachedMap;
}

export function TagDots({ item }: { item: ZItem }) {
  const show = useStore((s) => s.showTagColors);
  const tagColors = useStore((s) => s.library.tagColors);
  if (!show || !tagColors?.length) return null;

  const map = colorMap(tagColors);
  const dots = (item.data?.tags ?? [])
    .map((t) => ({ name: String(t.tag), hit: map.get(String(t.tag).trim().toLowerCase()) }))
    .filter(
      (d): d is { name: string; hit: { color: string; order: number } } =>
        Boolean(d.hit),
    )
    // Zotero's own order (the shortcut number), not the item's tag order.
    .sort((a, b) => a.hit.order - b.hit.order)
    .slice(0, MAX_DOTS);
  if (dots.length === 0) return null;

  return (
    <span className="tag-dots">
      {dots.map((d) => (
        <i
          key={d.name}
          className="tag-dot"
          style={{ background: d.hit.color }}
          title={d.name}
        />
      ))}
    </span>
  );
}
