// Toolbar and page-overlay glyphs for the PDF viewer, as SVG strings —
// the viewer builds its DOM by hand (ported from Hush's
// src/pdf/pdf-viewer-icons.js).

export const VERTICAL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="9" width="10" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const HORIZONTAL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="3" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="3" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const THUMBNAIL_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const FIT_ONE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

export const FIT_TWO_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="9" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;

export const FIT_THREE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="0.5" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="6" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="11.5" y="2" width="4" height="12" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

export const POPOUT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19L19 6M19 6V18.48M19 6H6.52"/></svg>`;

export const FOLD_ICON = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="10.5" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 8 H12.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>`;

export const FILTER_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 3h12l-4.5 5.2V13l-3 1.5V8.2L2 3z"/></svg>`;

/** Hush's bookmark slot on a page becomes "cite this page in the notes"
 *  here: a pencil over a page corner. */
export const PAGE_NOTE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>`;

export const EXPAND_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6 L8 2.5 L12 6"/><path d="M4 10 L8 13.5 L12 10"/></svg>`;

export const COLLAPSE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5 L8 6 L12 2.5"/><path d="M4 13.5 L8 10 L12 13.5"/></svg>`;
