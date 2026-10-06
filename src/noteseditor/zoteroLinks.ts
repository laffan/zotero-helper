// The first custom renderer: Zotero links as pills.
//
// `[p. 22](zotero://open-pdf/library/items/KEY?page=22)` renders as a
// small "p. 22" pill — tinted with the highlight's colour when the link
// names an annotation — whenever the caret isn't inside it. A tap on the
// pill follows the link (to the page in the open PDF, or into Zotero);
// with ⌘/Ctrl/Alt held it puts the caret inside instead, which shows
// the Markdown for editing. Pills are atomic: arrows step over one and
// Backspace removes it whole.
//
// Plain web links are rendered by livePreview.ts; ⌘/Ctrl-click opens one
// (a plain click edits it, as in Hush).
import { syntaxTree } from "@codemirror/language";
import { Facet, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { linkUrl } from "./livePreview";

export interface LinkHandlers {
  /** Follow a link. */
  follow: (href: string) => void;
  /** The highlight colour for an annotation key, when it is known. */
  annotationColor?: (key: string) => string | undefined;
}

export const linkHandlers = Facet.define<LinkHandlers, LinkHandlers>({
  combine: (v) => v[0] ?? { follow: () => {} },
});

const PAGE_ICON = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>`;

const hasModifier = (e: MouseEvent | PointerEvent) => e.metaKey || e.ctrlKey || e.altKey;

class PillWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly href: string,
    readonly color: string | undefined,
    readonly from: number,
  ) {
    super();
  }

  eq(other: PillWidget): boolean {
    return other.label === this.label && other.href === this.href && other.color === this.color && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const pill = document.createElement("span");
    pill.className = "cm-zotero-pill";
    pill.title = `${this.href}\n⌘-click to edit`;
    if (this.color) pill.style.setProperty("--pill-color", this.color);
    const icon = document.createElement("span");
    icon.className = "cm-zotero-pill-icon";
    icon.innerHTML = PAGE_ICON;
    pill.append(icon, document.createTextNode(this.label));
    // pointerdown, on the element itself: it arrives before the tap
    // moves the caret (which would re-render the pill away from under
    // the click), on touch as with a mouse.
    pill.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (hasModifier(e)) {
        view.dispatch({ selection: { anchor: this.from + 1 } });
        view.focus();
        return;
      }
      view.state.facet(linkHandlers).follow(this.href);
    });
    return pill;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const handlers = state.facet(linkHandlers);
  const sel = state.selection.ranges;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "FencedCode" || node.name === "InlineCode") return false;
        if (node.name !== "Link") return;
        const url = linkUrl(state, node.from, node.to);
        if (!url?.url.startsWith("zotero://")) return false;
        // Shown raw while the caret is inside it, so it can be edited.
        if (view.hasFocus && sel.some((r) => r.from > node.from && r.to < node.to)) return false;
        const text = state.sliceDoc(node.from, node.to);
        const close = text.indexOf("](");
        const label = close > 1 ? text.slice(1, close) : "Zotero";
        const annotation = /[?&]annotation=([A-Z0-9]+)/i.exec(url.url)?.[1];
        const color = annotation ? handlers.annotationColor?.(annotation) : undefined;
        out.push(
          Decoration.replace({ widget: new PillWidget(label, url.url, color, node.from) }).range(node.from, node.to),
        );
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

const pills = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

/** ⌘/Ctrl-click on a rendered web link opens it. */
const webLinkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-md-link");
    if (!el || !hasModifier(e)) return false;
    const href = el.dataset.href;
    if (!href) return false;
    e.preventDefault();
    view.state.facet(linkHandlers).follow(href);
    return true;
  },
});

const pillTheme = EditorView.theme({
  ".cm-zotero-pill": {
    "--pill-color": "var(--accent)",
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "0 6px 0 5px",
    margin: "0 1px",
    borderRadius: "9px",
    fontSize: "0.85em",
    lineHeight: "1.55",
    fontWeight: "600",
    color: "var(--text)",
    background: "color-mix(in srgb, var(--pill-color) 18%, transparent)",
    border: "1px solid color-mix(in srgb, var(--pill-color) 45%, transparent)",
    cursor: "pointer",
    verticalAlign: "baseline",
    whiteSpace: "nowrap",
  },
  ".cm-zotero-pill:hover": {
    background: "color-mix(in srgb, var(--pill-color) 30%, transparent)",
  },
  ".cm-zotero-pill-icon": { display: "inline-flex", opacity: "0.7" },
});

export function zoteroLinks(handlers: LinkHandlers) {
  return [linkHandlers.of(handlers), pills, webLinkClicks, pillTheme];
}
