// Colored-tag swatches. In Zotero a handful of tags can be assigned a
// color (and a 1..9 shortcut key); the *items* only carry tag names, so
// the colors come from the library's `tagColors` setting, fetched by the
// sync engine. Rendered before the title in list view and on the caption's
// second line in icon view.
//
// A tag named with an emoji ("📌 to read") shows its glyph instead of the
// swatch — the emoji already says what the color only hints at, and it is
// how Zotero itself draws these.
import { useStore } from "../lib/store";
import type { TagColor, ZItem } from "../lib/types";

/** At most this many swatches per item — beyond four they stop reading
 *  as distinct marks and start eating the title. */
const MAX_DOTS = 4;

/** Emoji, including multi-codepoint sequences: skin-tone modifiers,
 *  variation selectors, and ZWJ-joined families. */
const EMOJI_RE =
  /\p{Extended_Pictographic}(\uFE0F|\p{Emoji_Modifier})?(\u200D\p{Extended_Pictographic}(\uFE0F|\p{Emoji_Modifier})?)*/gu;

interface TagStyle {
  color: string;
  order: number;
  /** The emoji in the tag's name, if any — shown in place of the dot. */
  emoji: string;
}

/** Name → color/position/emoji, rebuilt only when the setting itself
 *  changes. Every visible row calls this, so it must not allocate per
 *  row (nor re-run the emoji scan). */
let cachedSource: TagColor[] | null = null;
let cachedMap = new Map<string, TagStyle>();

function styleMap(list: TagColor[]): Map<string, TagStyle> {
  if (list !== cachedSource) {
    cachedSource = list;
    cachedMap = new Map(
      list.map((t, i) => [
        t.name.trim().toLowerCase(),
        { color: t.color, order: i, emoji: t.name.match(EMOJI_RE)?.join("") ?? "" },
      ]),
    );
  }
  return cachedMap;
}

export function TagDots({ item }: { item: ZItem }) {
  const show = useStore((s) => s.showTagColors);
  const tagColors = useStore((s) => s.library.tagColors);
  if (!show || !tagColors?.length) return null;

  const map = styleMap(tagColors);
  const dots = (item.data?.tags ?? [])
    .map((t) => ({
      name: String(t.tag),
      hit: map.get(String(t.tag).trim().toLowerCase()),
    }))
    .filter((d): d is { name: string; hit: TagStyle } => Boolean(d.hit))
    // Zotero's own order (the shortcut number), not the item's tag order.
    .sort((a, b) => a.hit.order - b.hit.order)
    .slice(0, MAX_DOTS);
  if (dots.length === 0) return null;

  return (
    <span className="tag-dots">
      {dots.map((d) =>
        d.hit.emoji ? (
          <span key={d.name} className="tag-emoji" title={d.name}>
            {d.hit.emoji}
          </span>
        ) : (
          <i
            key={d.name}
            className="tag-dot"
            style={{ background: d.hit.color }}
            title={d.name}
          />
        ),
      )}
    </span>
  );
}
