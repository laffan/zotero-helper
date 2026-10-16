// Toolbar and page-overlay glyphs for the PDF viewer, as SVG strings —
// the viewer builds its DOM by hand (ported from Hush's
// src/pdf/pdf-viewer-icons.js).

export const VERTICAL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="9" width="10" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const HORIZONTAL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="3" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="3" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

/** Reading mode: four corners pushed out to the edges. */
export const READING_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5v-4h4"/><path d="M10.5 1.5h4v4"/><path d="M14.5 10.5v4h-4"/><path d="M5.5 14.5h-4v-4"/></svg>`;

export const THUMBNAIL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const FIT_ONE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const FIT_TWO_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="9" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;

export const FIT_THREE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="0.5" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="6" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="11.5" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

/** Fixed: a page between "turn" chevrons. Continuous: a page with its
 *  neighbours running off both edges. Drawn side to side; the toolbar
 *  turns them upright while the pages scroll vertically. */
export const FIXED_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="1.5" width="7" height="13" rx="1"/><path d="M2.3 6.3 L0.8 8 L2.3 9.7"/><path d="M13.7 6.3 L15.2 8 L13.7 9.7"/></svg>`;

export const CONTINUOUS_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="5" y="1.5" width="6" height="13" rx="1"/><path d="M0.5 1.5h1.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H0.5"/><path d="M15.5 1.5H14a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1.5"/></svg>`;

export const POPOUT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19L19 6M19 6V18.48M19 6H6.52"/></svg>`;

export const FOLD_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="10.5" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 8 H12.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>`;

export const FILTER_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 3h12l-4.5 5.2V13l-3 1.5V8.2L2 3z"/></svg>`;

/** Hush's bookmark slot on a page becomes "cite this page in the notes"
 *  here: a pencil over a page corner. */
/** The page bookmark button; filled (CSS) on a page that has one. */
export const BOOKMARK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z"/></svg>`;

export const EXPAND_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6 L8 2.5 L12 6"/><path d="M4 10 L8 13.5 L12 10"/></svg>`;

export const COLLAPSE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5 L8 6 L12 2.5"/><path d="M4 13.5 L8 10 L12 13.5"/></svg>`;

/** The selection bar's two kinds of mark: a highlighter band, and an
 *  underlined U. */
export const HIGHLIGHT_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="currentColor" opacity="0.3"/><path d="M4.5 8h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

export const UNDERLINE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.5 2.5v4.5a3.5 3.5 0 0 0 7 0V2.5"/><path d="M3 14h10"/></svg>`;
