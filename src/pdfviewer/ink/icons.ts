// The ink bar's glyphs, as SVG strings like the viewer's own (../icons.ts).

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const PEN_ICON = svg(`<path d="M11.2 2.3l2.5 2.5L5.6 12.9l-3.3.8.8-3.3z"/><path d="M9.8 3.7l2.5 2.5"/>`);

export const ERASER_ICON = svg(`<path d="M6.2 13.5L2.4 9.7a1 1 0 0 1 0-1.4l5.9-5.9a1 1 0 0 1 1.4 0l3.8 3.8a1 1 0 0 1 0 1.4l-6 5.9z"/><path d="M5 7.1l4.9 4.9"/><path d="M6.2 13.5h7.3"/>`);

export const SELECT_ICON = svg(`<path d="M3 3l3.8 10 1.6-4.3L12.7 7z"/><path d="M8.4 8.7l4 4"/>`);

export const UNDO_ICON = svg(`<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/>`);

export const REDO_ICON = svg(`<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/>`);

export const TRASH_ICON = svg(`<path d="M2.5 4.5h11"/><path d="M6 4.5V3h4v1.5"/><path d="M4 4.5l.7 9h6.6l.7-9"/>`);
