# Zotero Helper — technical guide

The full description of the app: what every feature does and how, where
the code for it lives, and the rules for changing it. This is the
document for contributors — and for AI agents working on the codebase,
who should read [Code organization rules](#code-organization-rules)
before writing anything. [README.md](README.md) is the short overview and
the installation steps.

Contents: [Code organization rules](#code-organization-rules) ·
[Architecture](#architecture) · [Features](#features) ·
[Settings](#settings) · [Keyboard shortcuts](#keyboard-shortcuts) ·
[Hush integration](#hush-integration) ·
[Building and testing](#building-and-testing) · [Roadmap ideas](#roadmap-ideas)

## Code organization rules

Hard rules for this repository — they apply equally to human contributors
and **AI agents** working on the codebase:

1. **700-line limit on every code file, no exceptions.** This covers *all*
   file types — Rust, TypeScript/TSX, CSS, build scripts, everything. The
   limit is enforced by `scripts/check-line-limit.mjs`, which runs as part of
   `npm run build` and fails the build on violation. Check at any time with
   `npm run check:lines`. Never raise the limit or exempt a file; if a file
   is getting close, that is the signal to restructure *before* it overflows.
2. **Split by feature, not by line count.** When a file needs dividing, cut
   along feature boundaries so each module stays independently
   understandable. Existing precedents to follow: metadata resolution is
   `src-tauri/src/resolve/` with one file per source (CrossRef/DOI, ISBN,
   arXiv, URL scraping) and shared helpers in `mod.rs`; styles are
   `src/styles/` with one sheet per UI region, imported in cascade order from
   `index.css`. New features should arrive as new sibling modules, not as
   growth inside an existing file.
3. **No junk-drawer modules.** Shared helpers belong in the owning feature's
   `mod.rs` / `index.css` / a narrowly-named module — don't create a generic
   `utils` file that everything imports and that slowly absorbs the app.
4. Note for Rust: `cargo` does not run the line check, but `npm run build`
   (which `tauri build` invokes) scans `src-tauri/src` too — so the rule is
   enforced on every packaged build. Run `npm run check:lines` after backend
   work regardless.
5. **Keep this document current.** A change to a feature's behaviour, a
   new module or a new rule belongs here in the same change — this file
   is what the next contributor (or agent) reads to understand the app.
6. **Match the code around you.** Each module opens with a comment that
   says what it is for and why it works the way it does; new modules do
   the same, and comments explain intent rather than restate the code.
   Font sizes in CSS are written `calc(Npx * var(--font-scale))` so the
   UI font size setting reaches them, and colours come from the tokens
   in `src/styles/tokens.css` so both themes do.

## Architecture

### Source map

```
src/            React + TypeScript UI (Vite, zustand, MiniSearch)
  lib/          store, import pipeline driver, search index, actions,
                drag-and-drop, PDF-pattern bookkeeping
  lib/ai/       the AI features: toolbar actions (index), the model
                catalog and its prices (models), gathering works to ask
                about (context), conversations (chat), the reader's
                explainer of a passage (explain) and look-up (lookup),
                their editable prompts (prompts), export
  lib/words.ts  Words: every word looked up in a PDF, and where
  lib/bookmarks.ts
                the reader's bookmarks: the store, its file (through
                src-tauri/src/bookmarks.rs), and each as an entry for
                the Highlights tab
  lib/highlights.ts, lib/notes.ts
                annotations out of the library cache; NOTES.md load /
                save / periodic push, the PDF cache
  lib/recent.ts, lib/readerUi.ts, lib/outline.ts
                Recent and the page each PDF was left on; the reading
                UI around each PDF (panels, filters, searches), kept
                beside it; PDF outlines and filing highlights under
                their sections
  lib/pdfQuote.ts, lib/pdfHighlight.ts
                finding an AI citation's quoted passage in a PDF (the
                page sweep; the word matching)
  lib/dragGesture.ts
                pointer drags (pane edges, columns, items) that keep
                text selection off while they last
  lib/shortcuts/
                the keyboard shortcuts: bindings (the actions, their
                default keys, the reader's rebinding, combo parsing and
                display), dispatch (the one keydown listener, contexts,
                the typing guard), run (what each action does), panes
                (Tab between panes; the sidebar cursor; the details
                panel's tabs), listNav (the item list / icon grid
                selection from the arrows), hoverFocus (the pointer
                over the pages or the notes moves the focus there)
  lib/appearance.ts, lib/panels.ts
                Settings → General's theme and UI font size; showing and
                hiding the side panels (toolbar buttons and shortcuts)
  lib/annotationEdits.ts, lib/pendingAnnotations.ts
                highlights and drawings made in the reader: create /
                edit / delete, the push schedule, and unsent changes
                laid over the library until a sync includes them
  lib/pencil.ts the Apple Pencil's double-tap and squeeze, from
                tauri-plugin-pencil, as a window event for ink mode
  lib/penTool.ts
                the eraser shared by ink mode and the notepad, which
                the double-tap turns on and off
  lib/statusBar.ts
                asking tauri-plugin-status-bar, at boot, whether the
                status bar is hidden (the `status-bar-hidden` class)
  components/   toolbar, sidebar, virtualized item list, metadata panel
                and its tabs (Highlights, Notes — NotesPrompts is an
                empty note's reading questions), reader pane (and
                ReadingModeExit, reading mode's way back and its
                buttons; ExplainChat, the explainer's window;
                ExplanationList, the explanations as boxes, and the
                sidebar's Explanations;
                NotepadBody, a view of the notepad, and ReadingNotepad,
                its floating or edge-docked window), WordList (Words),
                terminal, import/rescue modals
  notepad/      the notepad: model (notes, links, storage, the pad
                shared between views), surface (the canvas: the Pencil
                writes, a finger pans), geometry (paths, hit tests),
                links (the links' chips, their sizing and menu), lasso
                (a long press selects), minimap (the whole pad, small)
  components/settings/
                the settings page: SettingsView (section list, the
                draft and Save) and one component per section —
                General, Zotero, Cache, AI (and its Prompts), Shortcut
  pdfviewer/    the PDF viewer beside the notes, ported from Hush (viewer,
                render, paint (annotations into the rasters),
                annotations, folds and foldSpecs (the regions that
                fold), thumbnails, links, toolbar,
                viewPrefs (the layout last chosen), viewState (each
                PDF's own, as it was left), layout (the modes' CSS
                classes and fit scales)) plus paged (the
                paged view's sets of pages), pageTools (text
                layer, notes hooks), search (find in the PDF), and
                outline (the PDF's bookmarks, resolved to places),
                anchor (keeping the place across a relayout),
                tooltips (the toolbar's, drawn for iPad), keys (zoom
                shortcuts and the page stepper), commands (the
                keyboard's viewer commands: modes, page and fold
                steps), crop (the paged view's trimmed reading),
                citeMark (an AI citation's passage, marked), passageMarks
                (the passages the AI explained, the words looked up),
                darkPages (the pages white on black), pencilFinger
                (the Pencil out of ink mode, a finger), bookmarkHold
                (reading mode's hold on a corner), places (where the
                reader is, what is at a point — for the notepad), and
                annotating (the pieces below, put together):
                selectionBar (colours over a selection),
                annotate (selection → Zotero position, tap hit-test),
                annotPopover (colour / comment / delete),
                lookupPopup (a look-up's definition, over the bar),
                highlightHandles (a highlight's ends, dragged),
                sentenceMark (⌘-click or the sentence tool selects a
                sentence), textHit
                (the text under a point);
                viewerOptions (what the host hands the viewer),
                textSelect (selections that narrow), selectGuard
                (a selection's leap to a page's end, undone),
                readingProgress (the page indicator — the bar's, and
                reading mode's — the thumbnails and the page picker
                its presses open), magnify (the
                pinch's loupe over the pages), pageSizes (odd-sized
                pages brought to the typical page's size)
  pdfviewer/ink/
                drawing (Zotero's pen): index (ink mode, wiring),
                session (the drawings and this viewer's unwritten
                changes, merge rule, undo, the deferred write), layer
                (each page's ink as SVG), live (the stroke under the
                pen), input (Pencil / mouse / finger rules), geometry
                (Zotero's smoothing, eraser, merge distances), bar
  noteseditor/  the notes editor: CodeMirror setup, live preview,
                Zotero-link pills, the cite-this-page gutter, the
                formatting shortcuts, `==highlight==` syntax, prompts
                (the reading questions and the "?" menu)
  styles/       one stylesheet per UI region (tokens, base, toolbar, …;
                keyboard = the pane outline and sidebar cursor;
                pdfviewer-dark = dark pages; explanations = the
                explanation boxes)
src-tauri/      Rust core (all networking + state)
  src/zotero/      Zotero Web API v3: paginated sync (sync), versioned
                   writes, and attachment files (files — create, upload
                   or replace with md5 preconditions, read one item)
  src/notes.rs     NOTES.md on the device and its push/pull with Zotero
  src/annotations.rs
                   the outbox of annotation writes and its push (the
                   HTTP half is src/zotero/annotations.rs)
  src/pdfcache.rs  PDFs kept on the device to read beside notes
  src/storage.rs   Settings → Cache's storage report
  src/resolve/     identifier → Zotero item data; one file per source
                   (mod = classify/dispatch, doi, isbn, arxiv, url)
  src/pdf/         PDF discovery and download (mod = Unpaywall + link
                   scraping + validated downloads, per-host rate limiter;
                   patterns = learned per-publisher PDF URL shapes)
  src/ai/          model access, one file per concern (mod = provider
                   dispatch, anthropic, openai, tidy, chat)
  src/chats.rs     the Questions conversations on disk
  src/words.rs     the Words looked up, on disk
  src/notepads.rs  the notepads on disk, one per PDF
  src/bookmarks.rs the reader's bookmarks on disk (bookmarks.json)
  src/capture.rs   desktop capture-browser window (download interception)
  tauri-plugin-capture-view/, tauri-plugin-share-sheet/,
  tauri-plugin-keyboard-focus/, tauri-plugin-pencil/,
  tauri-plugin-status-bar/
                   the app's own iOS plugins: the capture browser's
                   WKWebView, the share sheet, handing the web view
                   the hardware keyboard (first responder), the
                   Apple Pencil's double-tap / squeeze, and the app
                   full screen (the status bar hidden)
  Info.ios.plist   keys merged into the generated iOS Info.plist
```

### State and where it lives

The library cache and settings live in the platform app-data directory as
plain JSON. The import pipeline is orchestrated from the frontend (one job at
a time; the Rust side enforces per-host politeness delays) so every step is
visible in the UI and the log.


Device-local UI state (pane widths, folder views, theme and font size,
…) is a persisted zustand store in `localStorage` (`src/lib/store.ts`,
key `zotero-helper-ui`). Rebound shortcuts are their own store
(`zotero-helper-shortcuts`), and each PDF's view and reading UI are kept
beside Recent (`src/lib/recent.ts`). None of it is written to Zotero.
Settings that the Rust core needs (keys, the model, the rate limit) are
the `Settings` struct, saved through `save_settings` — adding a field
there means adding it on the Rust side too.

### pdf.js assets

pdf.js loads some of what it needs by URL at run time — the
WebAssembly JBIG2 / JPEG 2000 decoders that scanned PDFs depend on,
ICC profiles, standard fonts, CMaps. `vite.config.ts` serves those
directories of `pdfjs-dist` under `/pdfjs/` and copies them into the
build, and `src/lib/pdfjsAssets.ts` hands every `getDocument` call
their URLs.

## Features

### Full screen on the iPad

While the app's window fills the screen, the system's status bar is
hidden and the home indicator fades, and the band the app otherwise
keeps clear at its top (for the bar and, windowed, the window controls)
goes to the app (`tauri-plugin-status-bar`, ported from Hush's
`ChromeControl.swift`). iPadOS gives an app no call that makes its
window full screen (`UIRequiresFullScreen` is deprecated from iPadOS
26), so a window the person has made smaller — Split View, Stage
Manager, iPadOS 26+ windowing — keeps its bar and the band, since that
is where the system puts the window controls; dragging a window between
the two re-evaluates (the scene's `effectiveGeometry`, iOS 16+). In full
screen the window controls live in the hidden bar, so with a trackpad or
mouse the pointer in the top-left corner (120 × 40pt) shows the bar
again, over the app rather than pushing it down, until it leaves a
larger box (280 × 80pt). The bar is hidden through tao's root view
controller (`setPrefersStatusBarHidden:` — the only lever left under the
iOS 27 SDK, which needs `UIViewControllerBasedStatusBarAppearance` at
YES, pinned in `src-tauri/Info.ios.plist`), and a swizzle of the getter
reaches view controllers presented over the web view. The page hears of
it as `status-bar-hidden` on `<html>`, set by the native side whenever
it changes and once more when the page asks at boot
(`lib/statusBar.ts`); `base.css`, `readingmode.css` and `notepad.css`
keep the band only under `.ipados:not(.status-bar-hidden)`. Off the iPad
nothing changes.

### The library

**Bare-bones Zotero browser** — your whole library (metadata only, no
attachment files) is downloaded via the Zotero Web API and cached locally:
nested collections in the left sidebar, items on the right, an editable
metadata panel on the far right. Columns are resizable; on narrow screens
the side panels become slide-over drawers.

**Folder views** — each folder remembers its own local presentation:
items **pinned** to the top, and an **icon view** that shows each PDF's
first page (annotations included) as a thumbnail, rendered once and
cached on disk (`thumbs/` in the app data dir, kept between
launches). A cached thumbnail is redrawn only when the highlights
*on its first page* change — not for a highlight elsewhere in the
PDF, and not when a sync merely bumps item versions. A file Zotero
holds with no parent entry is its own attachment, so it gets a
thumbnail like anything else. Once every
cover in a folder has been rendered, the list view shows them too,
tiny, in a column before the title (the list never sets off a render
itself). Both are app-side only — nothing is written to Zotero.

**Colored tags** — Zotero's colored ("numbered") tags show as swatches
before the title in list view and on the caption's second line in icon
view, up to four per item, in Zotero's own 1–9 order. A tag named with an
emoji ("📌 to read") shows its glyph instead of the swatch — the emoji
already says what the color only hints at. The tag button in the view bar
toggles them; the colors themselves come from the library's `tagColors`
setting, refreshed on every sync.

**Flagged folders** — the flag at the left of the view bar lifts the
current collection into a "Flagged" list pinned above Library in the
sidebar (the list hides itself when nothing is flagged; unflag from
either end). Local only, like pins and view modes.

**Folder menu** — hovering a folder in the sidebar shows a menu
button at the right of its row: flag or unflag it, rename it (in place; the collection is
renamed in Zotero), download all of its PDFs to the device, or delete
it (a second click confirms).

**Panel buttons** — the two panel icons at the ends of the toolbar
fold the sidebar and the details panel away and back on a wide
window, and slide them in as drawers on a narrow one.

**Attachments** — the metadata panel lists every attachment on an item
(Zotero allows many), each with its own share button. Selecting a file
that has *no* parent entry swaps the full editor for a short panel —
name, URL, type, filename, added/modified — because that is all Zotero
keeps for one; it lists under its filename when it has no title.

**The details panel reads as a record.** Fields show their values as
text — the abstract in full, not squeezed into a five-row textarea —
and hovering a field's label reveals a small **Edit** link that swaps
just that field for an input. Save is still the single commit point.

**What we have for each entry** — two marker columns at the right of the
item list: one for a PDF attachment, one for an abstract on record. Both
are what the AI features work from, so it's worth being able to see at a
glance which entries are ready. The PDF mark is filled once that PDF is
downloaded to this device. Holding ⌘ (Ctrl on Windows/Linux) turns the
marks into buttons — download on the empty ones, remove on the filled
— that act without changing the selection; the icon view shows the
same mark, smaller, at the right of each caption's author line.

**Summary select** — selecting multiple items collapses the right panel
into per-item summary cards (title/authors/abstract by default — the field
set is configurable from the "Fields" popup, where the abstract can be
abbreviated or full; that choice only affects the cards, exports always
carry the whole abstract). Clicking a card narrows the selection to that
item, and "Share filtered metadata" exports the cards as Markdown,
titles linked back to their Zotero entries.

**Drag items into folders** — drag from the item list (or the icon view)
onto any collection in the sidebar and the items are filed there; a
drag that starts on a selected row carries the whole selection. Works
with a mouse (a few pixels of movement starts the drag) and with a
finger on iPad (press and hold, so ordinary scrolling still scrolls) —
pointer events throughout, since HTML5 drag-and-drop is unreliable in a
WKWebView. Zotero keeps an item in every collection it was added to, so
this only ever adds: nothing leaves the folder it was dragged from.

Multi-select with the usual ctrl/cmd-click and shift-click patterns.

### Search

**Search** — a MiniSearch index over every field (title, authors, abstract,
tags, DOI, publication, year…), fast enough for thousands of entries on an
M1 iPad Pro. The magnifier opens a mode menu that narrows what a query
runs against: *all metadata* (the default), *titles*, *authors*,
*publication*, or a *date range* — two year boxes, either end open-ended,
which filters on the parsed year instead of running a text query. The
active mode is the field's placeholder, so the box always says what it
will search, and results always render as a list whatever view the
folder is set to (relevance order is invisible in a grid of thumbnails).

### Import and PDFs

**Import IDs with PDFs** — paste a list of DOIs / ISBNs / arXiv IDs / URLs.
Each identifier appears as a live row in the item list and advances through
a visible pipeline: *resolve metadata → create Zotero item → find PDF →
download → upload to Zotero*. Metadata comes from CrossRef (DataCite
fallback), Open Library / Google Books, arXiv, or Highwire meta tags. PDFs
are discovered via Unpaywall, CrossRef full-text links, and
`citation_pdf_url` scraping — all rate-limited.

**Fetch PDFs for existing entries** — select any items already in your
library (multi-select works) and run the same PDF pipeline without
re-creating metadata. Entries missing a DOI get one discovered first via
CrossRef bibliographic search (strict title/year matching — no match
beats a wrong match) and the found DOI is written back to Zotero.

**Manual PDF rescue** — when the automatic download is blocked (paywalls,
Cloudflare, …) the row parks in "PDF needs your help" and offers an
embedded **capture browser modal** on every platform: a child webview
inside the main window on desktop, a native WKWebView overlay on iPad
(with MIME-type PDF detection and cookie-aware downloads via a custom
plugin). Downloads and PDF navigations are intercepted and attached
automatically, popup-style "Download PDF" buttons are rewritten to work,
and "Grab this page" handles viewers we don't recognize. System browser +
file picker, candidate links, and a direct-URL box remain as fallbacks.
The parked row's button is split in two: **Find PDF** opens that list of
options, the globe beside it goes straight to the capture browser, which
is where most rescues end up anyway.

**Learned PDF locations** — publishers are consistent with themselves, so
every PDF that *works* teaches the app where that source keeps its files:
the URL is stored as a template with the DOI blanked out
(`https://…/doi/pdf/{doi}`) and, where the PDF sat one substitution away
from the landing page, as that rewrite (`/doi/full/` → `/doi/pdf/`). Later
items from the same publisher (matched on the DOI prefix or the landing
host) get those URLs as extra candidates, tried *after* the open-access
ones. The payoff is a batch: walk one paper past a robot check by hand in
the capture browser and everything else parked on that source is
re-queued with the pattern that just worked. Speculating at a site that
watches for robots is done slowly and gives up early — at least 20s
between two such requests to one host, a 15-minute back-off once three in
a row are refused, and a pattern that keeps missing is forgotten. The
pause is charged when a learned URL is actually tried, so an item whose
open-access copy downloads first never waits for one. The book lives in
`pdf-patterns.json` beside the library cache.

Imported PDFs are only held in a temp folder during upload and deleted
right after — the copy of record lives in Zotero (where your iPad Zotero
app syncs it). The one exception is a PDF you download to read beside your notes:
that copy stays in the PDF cache (`pdfs/` in the app data dir) until you
remove it from Settings, and while it is there every other reader of
that PDF (thumbnails, page citations, Ask Full Papers) uses it instead
of the network.

### Sync

**Re-sync** — the Sync menu offers three scopes: *Sync this folder*
(fetches only the current collection's changes — the day-to-day option
for five-digit libraries), *Sync all changes* (incremental via Zotero's
`?since=` versioning), and *Full refresh*. Local not-yet-uploaded rows
are never clobbered, and remote deletions are honored — an item or
collection moved to Zotero's trash counts as deleted (the `?since=`
fetches ask for the trash with `includeTrashed=1` to see it go). A
folder sync also asks Zotero which keys the folder holds now and looks
up any cached item that claims the folder but is not among them, so an
item removed from the folder, trashed, or deleted outright leaves it.
Folder syncs never advance the library version, so nothing elsewhere is
ever skipped.
Initial downloads are **resumable**: every page is retried with backoff
and journaled to disk, so flaky Wi-Fi or iPad app suspension resumes
where it stopped instead of restarting, and a catch-up pass afterwards
merges anything that changed during the long download.

### Sharing

**Share** — one toolbar menu for getting things out of the app: the
selected items' PDFs (downloaded from Zotero on the spot), a Markdown
document of titles (linked back to their Zotero entries) and
abstracts, or **Send to Hush**, which pushes the PDFs into the
[Hush](https://github.com/laffan/hush) writing app — pick a desk (and
optionally a project) and Hush downloads them itself through its own
Zotero credentials (see "Hush integration" below). The first two use
the system share sheet on iPad (via
`src-tauri/tauri-plugin-share-sheet/`) and save/folder dialogs on
desktop.

### Reading: the PDF viewer and notes

**Reading notes** — every entry has a **Notes** tab holding its
`NOTES.md`, always open for writing: a CodeMirror editor with the
Markdown (GitHub flavour, plus `==highlighted==` text, drawn as a
yellow marker band) rendered in place — headings, emphasis,
quotes, code and links show as formatted text, and a line's marks
reappear only while the caret is on it. ⌘I, ⌘B and ⌘= toggle
italic (`_`), bold (`**`) and highlight (`==`) on the selection, or
the word at the caret (inside such text, they take it off), and ⌘K
makes the selection a link's label with the caret where the URL
goes (a selected URL becomes the URL instead). Zotero links are drawn as
small page pills ("p. 22", tinted with the highlight's colour when
the link names one); a tap follows the link, ⌘-click shows the
Markdown to edit it. The right end of the tab bar holds the entry's
PDF: **Download PDF**, then **View PDF**, which turns the sidebar and
item list into a PDF viewer beside the notes (**Close PDF**, or the
back arrow at the toolbar's left, brings them back). Double-clicking an entry does both at once (an entry with
no PDF opens in Zotero instead). While the PDF is open the toolbar
shrinks to what applies to it — the back arrow, the document's name
(a press lists the last 20 PDFs opened, named the same way, to switch
to one without going back to the list; the × beside one takes it off
— off the sidebar's Recent too — until it is opened again), then
**Share** and **Sync** for that entry (Sync fetches new
highlights and pushes the notes, or downloads the PDF again) — and
the search field finds
words in the PDF: hits are boxed on the pages, listed under the field
with their page and a few lines of the surrounding text (a hundred at
a time, with *Show more matches* below), and stepped through with
Enter / ⇧Enter; the magnifier turns into a clear button while there
is a query, and ⌘F returns to the field. The arrow keys turn the page (see
[Keyboard shortcuts](#keyboard-shortcuts)). A PDF opens as it was left — on switching
to another and back (from the list or the recent-PDFs menu), and
from one session to the next: its layout (scroll direction, fit,
paged sets, zoom), the folded view with its zoom and filter, and the
place in it, to the pixel; and everything around it — the notes
panel's width and whether it is shown, the highlights / notes split,
the outline (shown or not, which headings are
unfolded, where it is scrolled), the Highlights tab's search, colours
and scroll, the search in the PDF on the match it was on (without
moving the pages from their own place), and the caret and scroll in
the notes. All of it is remembered per PDF on this device, beside
Recent. A PDF never opened here takes the layout and panels last
chosen; closing a PDF gives the library its details panel back as it
was. The tab in front is not remembered: a PDF opens on Highlights
(on Notes when it has none), except one opened from a conversation's
citation, which keeps the conversation in front (`setReading`'s tab). When the PDF has an outline,
a panel button at the left of the toolbar, before the name, shows it
beside the pages: a folding tree of its headings, each a link to its
place, with the section being read marked as you go. Widen the notes
panel past 600px and the Highlights and Notes tabs become one, with
the highlights beside the notes (drag the edge between them to share
the width differently); narrow it again and they separate. The
viewer's bottom toolbar draws its own tooltips — after a moment's
hover, or on a press-and-hold with a finger, which then doesn't press
the button — since iPadOS shows no `title` tooltips; a button with a
keyboard shortcut shows the key after its text, dimmed, as currently
bound (`data-shortcut` on the button, read by `tooltips.ts`). The bar
is in sections 14px apart — reading mode and dark pages, pages per
screen (fit one / two / three), scroll direction, paged / continuous,
folding, zoom (−, the zoom or fit, and + as one bordered group), the
sentence tool and the pen — and, at its right, where the reader is:
"54% | Pg 7 of 13" (the share of the document up to the page in view,
then the page, or the set's range, "Pg 7–9 of 13"), a press on which
shows every page at a glance, the thumbnail grid (G from the keyboard;
`createPageFinder` in `readingProgress.ts`). The viewer is a port of Hush's: horizontal or vertical
scrolling, fit one / two / three pages, zoom, a thumbnail grid, the
PDF's own links, Zotero's highlights, underlines and ink painted into
the pages, and the **folded view**, which collapses the paper to the regions around
its annotations (all of them, every type and colour, until the
filter button narrows it — Hush starts on red alone, its "come back to
this"; highlights made here always fold, whatever the filter). Text in the folds can be selected, copied and
quoted into the notes; marking it waits for the whole page — which a
fold's corner button opens in place, one page at a time (opening one
closes the other, without moving the one opened), and where the full
highlight bar and the highlight editor work as on the pages. Entering
and leaving the folded view keep the place. Going in, the fold
nearest what was at the centre of the view (reading the document as
one run of pages) is centred — on that very spot when the fold shows
it. Coming out, what was at the centre (on the open page, or the fold
nearest the centre) stays there. A fold
draws only its own strip of the page (all of it once expanded), so a
screen of folds costs about what a screen of pages does to scroll —
and an hour in the folded view costs what a minute does: what a fold
out of reach was holding (its raster, its text layer, pdf.js's copy
of its page) is let go, and the pages' own rasters are dropped while
the folds are up. Hush's annotation shelf is left out: the
Highlights tab beside the viewer already lists, filters and quotes
the same annotations. Beside the folded-view button, a **paged /
continuous** toggle (its icons turn with the scroll direction) chooses
between the pages as one strip and a set at a time — one, two
or three pages, as the fit buttons say, in either scroll direction.
The set is fitted whole and centred (the page indicator shows its
range, "7–9 / 13"), and a swipe moves to the next set — left/right
with horizontal scrolling, up/down with vertical — one set per swipe
however hard the flick (CSS scroll snapping, so the renderer and
everything over the pages is unchanged). A mouse wheel notch or a
trackpad swipe turns one set too, as do the arrow keys; zooming in goes back
to continuous, since pages larger than the view have no single place
to rest. Switching scroll direction keeps the page in view, and a
resize (reading mode in or out, a panel opening) keeps the set: the
one shown when it began is put back, centred, once the pages are laid
out again (`watchResize` in `anchor.ts` — the browser may otherwise
settle on the neighbouring set, and WebKit may not snap again at all,
leaving the set off-centre); side by side, the view is never left
scrolled vertically. It adds what note-taking needs: selectable text with
an *Add to notes* bubble that quotes the passage, inserted at the caret
with a `zotero://` link to the page (the bookmark button at the top
right of each page is under "Bookmarks" below). A selection follows
the pointer back as well as forward: pdf.js's own viewer keeps an empty
`.endOfContent` beside the moving end of the selection, so a pointer over
the gaps between lines doesn't make WebKit extend it to the end of the
page; the viewer's bare text layer lacked it, so a drag could only grow
(`src/pdfviewer/textSelect.ts`, ported from pdf.js's TextLayerBuilder).
WebKit still sometimes makes the moving end leap, in one step, from the
line under the finger to the very start or end of the page's text —
selecting the rest of the page, or all before it. `selectGuard.ts`
compares each change of a selection in the pages with the one before:
when one end stays put and the other moves more than three lines at
once to within the first or last two spans of a page, the selection is
put back as it was, and the next move of the finger carries on from
there. A real drag reaches a page's end a line or two at a time, and
crossing from the end of one page onto the next is allowed, so neither
is caught; keyboard selections and triple clicks are left alone. The
moving end flipping to the far side of where the selection began, more
than five lines away in one step, is put back the same way. A
selection made with a finger or the Pencil leaves `.endOfContent`
where it is: the iPad extends a touch selection by words and keeps
re-reading where a resting finger is, and with the element moved past
the moving end after every change, a selection held still crept on
down the page. The guard catches the gaps for those instead, and there
are few: on a touch screen each line's box reaches down over the gap
below it (`pointer: coarse` in `pdfviewer.css`; its text stays put), so
a finger between two lines is still over a line, and WebKit places the
end there rather than leaping — a leap the guard put back still showed,
as a blink. A passage's shape is measured from its text's own boxes
(`textRects` in `textHit.ts`), never the taller ones. The guard lets
pass only the change its own putting-back makes; a second leap arriving
first is put back too (ignoring the next change, whatever it was, once
let one stand, at the top of the page). A
page redrawn at the same zoom (a repaint after a sync, a sharper raster
under a pinch) swaps only its canvas: the text layer — and a selection
being made in it — stays (`render.ts`).
While the
PDF is open, a faint link icon sits at the left edge of the line being
written; pressing it heads the line with the page in view —
`Example note text` becomes
`[p. 22](zotero://open-pdf/library/items/6M6B2TX9?page=22) - Example note text`
(after any `- ` / `> ` / `## ` marker, replacing a page link already
there). Page pills move the open viewer rather than leaving for
Zotero.

**Reading mode.** The first button in the bottom bar (R from the
keyboard) gives the open PDF the whole window: the app's header, the
notes / details panel, the outline, the activity log and the viewer's
bottom bar are hidden (`readingmode.css`, under the `reading-mode` class
App.tsx puts on `.app` while the store's `readingMode` is on), and the
viewer refits the pages to the room through its own resize handling.
On the iPad the band kept clear above the app for the status bar and
window controls (when there is one — see Full screen on the iPad) goes
to the pages too. A red × at the top left
(below that band on the iPad) — or Escape — brings everything back as
it was (`ReadingModeExit.tsx`). Below it, down the left at the same
size and spacing, a red caret toggles the sentence tool (a tap selects
the sentence under it — see Highlighting) and a red pen toggles ink
mode (the Pencil writes, or selects and highlights like a finger); both
show white on red while on — the same 28px square behind each, whatever
its glyph's size — and are the viewer's own state (its
`onSentenceTool` / `onInkMode`, reflected in the store), so the bottom
bar's buttons and the keys agree with them. With ink mode on, a dot on
the pen shows the colour it writes in, and holding the pen a moment
(450ms) opens a flyout of the pen's colours beside it — Zotero's eight
and black, the bottom bar's colour chip, which reading mode hides; a
colour, a press elsewhere or Escape closes it, and the press that
opened it doesn't also end ink mode (`usePenColors` in
`ReadingModeExit.tsx`, through the viewer's `inkPen`). The flyout
begins with the notepad's switch of tools — pen, eraser, lasso (ink
mode's select tool) — and a colour picked there goes back to the pen.
The pen button shows the tool in force: the pen (with the colour dot),
an eraser (the eraser is shared with the notepad, `lib/penTool.ts`) or
a lasso (the store's `inkTool`, from the viewer's `onInkTool`). Below
the pen, in the next place down the left, a filled red rectangle is
the notepad's icon, dragged anywhere, which opens it (see The notepad).
The pages'
bookmark buttons are hidden in reading mode (a bookmarked page still
shows its filled button and name): holding a page's top-right corner
still for a full second opens the bookmark box for that page instead —
the button comes up under the finger and fills as the second counts —
to name a new bookmark, or rename or remove the one there
(`bookmarkHold.ts`; while the press lasts the page's text can't be
selected, so the iPad's own long press doesn't start under it). The bottom bar's page
indicator ("54% | Pg 7 of 13") floats at the bottom centre of the screen, 20px
up, and a press on it opens the page picker — the thumbnail grid as a
popup over the pages, the page being read marked and in view, with the
PDF's outline (when it has one) as a column at its left, the section
being read marked; a thumbnail or a heading goes there and closes it,
as do Escape and a press outside, without leaving reading mode
(`readingProgress.ts`, `thumbnails.ts`). It lasts the session and ends when the
PDF closes. Ink mode carries on in it: the Pencil writes, its double-tap
switches to the eraser, ⌘Z undoes; the bar's other tools wait for the
bar. On a touch screen every button in the bottom bar is finger-sized
(`hover: none` in `pdfviewer.css`), ink mode's tools and the rest alike.
Leaving reading mode, the viewer could stay at a shorter height than
its pane, a gap above the bottom bar until the app went to the
background and back. The viewer was sized as a percentage of a
stretched flex item, which WebKit can keep at an old value; it is now
a flex item itself (`.pdf-viewer`, `flex: 1 1 0`). As a backstop,
ReaderPane compares the viewer's height with its pane's once the change
has laid out and again 400ms later, and if they differ sets the height
outright for a frame (a relayout that keeps the scroll), noting it in
the activity log at debug level.

**Dark pages.** In the dark theme the bottom bar offers a light bulb
(off to begin with; the choice is this device's, `zh-pdf-dark`) that
draws the pages white on black (`darkPages.ts`, `pdfviewer-dark.css`).
It is a CSS filter over each page's raster, the folds' and the ink —
inverted, then turned half way round the colour wheel, so colours keep
roughly their hue — rather than pdf.js's `pageColors`, which would mean
drawing every page again at each switch and reduces images to two
tones; the text layer, selections and the app's own marks are left as
they are. Highlights painted into the pages come out as darker bands of
their colour, and photographs inverted. In the light theme the bulb is
hidden and the class does nothing, so the pages are as printed.

**Pinch to magnify.** A pinch over the pages magnifies them like a
loupe, and only them: the app itself never zooms (`index.html`'s
viewport is `user-scalable=no`, and `main.tsx` cancels WebKit's pinch
gesture everywhere), and the magnification is a transform on the scroll
area (`src/pdfviewer/magnify.ts`), so the layout — fit, paged sets, the
zoom the bar sets — is untouched, and pinching back out (below ×1.06)
leaves the pages exactly as they were. Up to ×5. While magnified, one
finger pans the view and coasts when let go, a trackpad's two-finger
scroll or a wheel pans it, and in the continuous views a pan carries on
past the edge as a scroll of the pages beneath (the paged view's set
stays put); the Pencil still writes. Once a pinch settles, the pages in
view are redrawn at ×1.5–×4 the resolution (`resolutionFor` →
`refreshResolution` in `render.ts`, the old raster kept up until the new
one replaces it). The one page nearest the view's centre may take up to
16.7 megapixels (4096², WebKit's largest canvas, `MAX_DETAIL_PIXELS`),
so a ×2 pinch is drawn at ×2; every other page keeps the usual cap (8 MP
on the iPad). One page only: WebKit also caps all of a page's canvases
together (reported at 224–576 MB, by device), and past that a new canvas
gets no context — pages stopped drawing, and with no raster no text
layer. Should it happen anyway, the renderer lets go of every page out
of view and draws the page plainly rather than leave it blank (it asks
for the canvas's context first, with pdf.js's own attributes). The redraw comes after the pinch,
never during writing: no page render starts while the Pencil is down
(`holdRenders` in `render.ts`, which retries every 120ms), since pdf.js
draws on the main thread, in slices, and would cost the stroke samples.
Any relayout ends the
magnification (a mode, a zoom step, a resize, a search hit or citation
being shown, a new PDF), since the code that keeps the place across one
measures the pages unmagnified. The pinch arrives as WebKit's
`gesturestart` / `gesturechange` (the iPad and the Mac app; the
fingers' midpoint from passive touch listeners), or elsewhere as a
ctrl-wheel (a trackpad pinch), which the reading crop's held ⌃ yields
to.

**Pages of their own size.** A journal's or JSTOR's cover sheet, a
scanned insert or a fold-out can be far larger or smaller than the
pages around it, and the layout used to fit and seed every page from
page 1 — so a large cover made the whole paper small. As a PDF opens, a
dozen pages are sampled (the first six and six spread through it) and
the median by area is the document's typical page, which the fit modes
fit and every page waits at until it is drawn
(`src/pdfviewer/pageSizes.ts`). A page whose area is more than 1.6× the
typical page's, or less than 1/1.6 of it, is scaled to fit the typical
page's box; a landscape page of the usual paper keeps its own size. The
scaling is a viewport at the page's own scale (`norm`) treated as its
scale-1 viewport, so its wrapper, text layer, highlights, ink, links and
search hits agree unchanged; only what draws it (the raster, the folds'
strips, the text layers) multiplies `norm` in, through `pageViewport`.
Bookmarks record the page's top in PDF space (its viewBox), not its
height.

**The paged view's use of space.** A set is fitted to the whole of
the viewer but a few pixels (`PAGED_PAD` in `src/pdfviewer/paged.ts`): no
frame of margin above and below, so the pages are as large as the view
allows, and the pages of a set sit `SET_GAP` (4px) apart. The scroll
area's padding is cut to match in `pdfviewer.css` (`.pdf-paged`).

**Trimmed reading.** In any view but the folded one, holding Control (⌃,
on every platform, leaving ⌘ to ⌘-clicks and shortcuts) with
the pointer over the pages, alone, for a moment (`HOLD_MS`, so a ⌃
shortcut doesn't set it off) shows the pages whole with the
current trim drawn over each — what is kept framed, the rest shaded — and
makes the trim's edges grabbable: each side has a dashed line and a
grip at its middle, and the side under the pointer (or being dragged)
turns solid on every page. A finger gets a wider reach than a mouse
(`GRAB_TOUCH_PX`), and on a touch screen, with the key held, the press
itself starts the adjustment. The hold is read from the key's own
`keydown` / `keyup` — not the pointer events' modifier flags, which
iPadOS doesn't report reliably — and "over the pages" from the last
pointer event anywhere in the window. Since iPadOS can drop the key-up
(after a system shortcut or an app switch), any keydown without ⌃, a
window blur or the app going to the background ends the hold. Dragging an edge trims that margin off
every page. Letting go of the key lays the pages out again with the
trimmed size as their bounds, so the pages fit the view by what is left and
the margins' room goes to the text. Holding the key again shows the pages
whole for the next adjustment, with a **Reset Reading Crop** button over
them. The folded view (which shows strips of the pages its own way) and
the thumbnails always show whole pages. The trim is kept with the PDF's view
(`SavedView.crop`), on this device; the file is never touched.

How it is drawn (`src/pdfviewer/crop.ts`): page wrappers keep their full
size, so everything that reads a page's geometry — the text layer,
annotation positions, search hits, the place kept across a relayout —
works unchanged. A trimmed page is clipped with `clip-path`, and negative
margins sized per page (`--cm-*`, set by `layout.ts` `sizePage`) close up
the room its trimmed edges would take. Matching negative `scroll-margin`s
make the snapping (and `scrollIntoView`) centre what is left rather than
the whole page. The fit (`fitZoom` → `pagedFitZoom`) uses the trimmed
size, and the renderer rasterises at the resulting scale.

**Highlighting.** Selecting text in the PDF brings up a small bar
above the passage (below it only when the passage starts at the top
of the view), on iPad as on the Mac:
Zotero's eight colours (5px further apart than the bar's other items,
for a finger), a highlight / underline switch beside them
(remembered between selections), then three icons — Copy (the text),
Add to notes (a quote with a link to its page; the Highlights tab's two
icons) and, with an AI service connected, Look up (see AI) — and the
AI's sparkles, which open the explainer (see AI). A colour marks
the passage the way Zotero's own reader does — as an annotation
item, child of the PDF attachment, with the same position, page
label and sort-index fields — so Zotero desktop, iOS and the web
library show it as one of theirs, and the PDF file itself is never
changed (Zotero keeps annotations out of the file too). A tap
anywhere on the pages — text, margin or the space between pages —
dismisses the selection and its bar as the finger lifts (the
browser alone ignores taps on the unselectable parts of a page, and
on iPad clears a selection only after its tap gestures settle).
Tapping a highlight or underline opens a
small editor: colour, comment, the same Copy / Add to notes / Look up
icons, and *Delete* (a second press confirms) — and puts a handle at each end of the passage,
a bar the height of the line with a knob above the start and below the
end, as the system's selection handles look. Dragging one moves that
end through the text by words, the other end staying put, with the new
extent drawn as it goes; letting go writes the new passage (rects, text
and sort index) as an edit of the same annotation, so its colour,
comment and key are kept. Over the gap between lines the dragged end
stays where it last was on a line (`textHit.ts`,
`highlightHandles.ts`). While the handles show, that page's text can't
be selected and a press on a handle cancels its touch, so the iPad
starts no selection of its own under them — no magnifier, no menu; the
dragged end is placed from the characters' own boxes, which needs no
selecting. A passage may run from one page onto the next, as in
Zotero's reader: the next page's part is the position's
`nextPageRects` (two pages at most; Zotero writes and reads the same),
painted, folded and tapped on both pages (`rectsOnPage` / `pagesOf` in
`lib/highlights.ts`); such a highlight has no handles yet. Only the
words in a page can be selected (the page wrappers are
`user-select: none`), so a selection crossing pages no longer takes in,
and tints, the margins between them. ⌘-clicking a line selects the
sentence it falls in, and the bar comes up over it to mark it in the
colour of the reader's choosing. The sentence tool does the same for a
plain tap: the caret in the bottom bar (and in reading mode), or S. It
selects only text nothing else has claimed: while it is on, a tap on a
highlight or underline (editable or not), on an explained passage or on
a word looked up does what it does without the tool (`claimed` in
`annotating.ts`); ⌘-click always selects. With something in the pages
already selected, the tool's tap — inside the selection or out — only
lets go of it, as any tap on the pages does (`selectionBar.ts`); the
next tap selects, so a stray tap never swaps one sentence for another
(`down.selected` in `sentenceMark.ts`; a ⌘-click still selects at
once). A sentence runs between two ".", "!" or "?" followed by a space
and a capital, a digit or an opening quote, so "e.g." and "3.5" don't
end one, nor do common abbreviations or initials; it never runs past
its page or more than 800 characters either way. ⌘ is read from its
own key events, as the reading crop reads ⌃ (`sentenceMark.ts`). A
mark shows at once; the write goes into
an outbox on the device (`annotations-outbox.json`) and is pushed a
moment later, every couple of minutes while anything waits, when the
app goes to the background and when it comes back online — so
highlighting a cached PDF offline works, and reaches Zotero later.
An edit made against an older version than Zotero's is sent again
over the newer one (the last edit wins, as in Zotero's reader).
Annotations Zotero imported from the PDF file stay read-only, as
they are in Zotero; in a group library, only annotations made in
this app on this device are editable here, since other members'
are theirs. Two values are close to Zotero's rather than identical:
the character offset in the sort index is counted in pdf.js's text
layer, not Zotero's own text extraction (it only orders annotations
within a page), and the page label comes from the PDF's own labels,
falling back to the page number. The writes are
`src-tauri/src/annotations.rs`; selection to position is
`src/pdfviewer/annotate.ts`.

**Drawing (ink).** The pen button in the bottom bar (I from the
keyboard) turns on ink mode: Zotero's pen tool. A drawing is an ink
annotation exactly as Zotero's reader makes one — `annotationType`
"ink", a position of `{ pageIndex, width, paths }` (each path a run of
x, y pairs in PDF points), a colour, page label and sort index, and no
text (the server refuses text on ink) — so Zotero shows what is drawn
here, and what is drawn in Zotero shows here, editable like the
app's own highlights. The rules are Zotero's (`zotero/reader`
`src/pdf/lib/path.js` and `pdf-view.js`, mirrored in
`src/pdfviewer/ink/geometry.ts`): a finished stroke is smoothed (two
rounds of Chaikin, points closer than 1pt dropped, 3 decimals); a stroke
drawn within 10s and 50pt of the last one, with the same colour and
width, is added to that annotation, so a written word is one annotation;
the eraser takes out the points inside its circle, splitting a line in
two, and deletes a drawing it empties. The pen button is the last in the
bottom bar; while ink mode is on, its tools follow it in the bar (which
scrolls sideways rather than squeeze them on a narrow viewer): pen,
eraser and select; one chip for the colour and width — a dot in the
colour, the width as a number — which opens a popup with Zotero's eight
colours and black over a width slider (0.1–3pt in tenths; with the
eraser, the eraser's size over Zotero's steps, 0.2–25pt); undo / redo
(⌘Z / ⇧⌘Z); and Delete for a selection. The pen button ends ink mode.
A drawing made in Zotero with a wider pen keeps its width (the slider
shows the nearest step). Samples are smoothed a little as they arrive
(`smooth` in `input.ts`): each drawn point goes only part of the way to
the pen's sample, less of the way the slower the pen moves, so a slow
line loses the hand's tremor and a fast one doesn't trail the tip; the
line drawn live and the one kept are the same points. Select is a lasso: it takes a drawing by a tap on its line, or every
drawing with a point inside a loop drawn round them (`inLoop` in
`session.ts`, the loop drawn dashed by `live.ts`); a drag from inside
the selection moves it, the colours and width restyle it, ⌫ deletes it.
The pen held still where it came down (500ms, within 4px) draws the
same lasso, as in Hush and the notepad: the stroke begun is dropped,
the loop is drawn on from there, and the tool stays the pen; a pen
pressed on the selection drags it, whatever the tool, and one pressed
anywhere else writes and lets go of it. (A drawing moved used to keep
the bounds it had before — `make` copied them along — so its frame,
and what a press on it hit, stayed where it had been.) Whatever the tool, a
finger is the select tool on drawings: one landing on a drawing's line
(within 16px) or on the selection selects it and drags it, and the bar's
colours, width and Delete then act on it, until a tap off it or a new
text selection lets go of it; a finger anywhere else scrolls
and selects text as ever (its touch isn't cancelled — `fingerGrabs`
decides at touchstart and pointerdown alike). The tool, colour and sizes
are this device's (`localStorage`, `zh-ink`). Only drawings this app may
edit (`canEditAnnotation`) can be erased, selected or added to.

Who draws: the Apple Pencil (`pointerType` "pen"), and nothing else. A
finger, a mouse or a trackpad does in ink mode what it does out of it —
scrolls and zooms the pages, selects text and highlights it, taps a
highlight or a link — so reading and writing need no mode change beyond
the pen in hand (`input.ts`; `pointerType` tells them apart in
WKWebView). Out of ink mode the Pencil is a finger — a precise one
(`pencilFinger.ts`). Left to WebKit it wasn't: it has gestures of its
own over text, which fought the viewer's handling of touch selections,
and highlighting with it was erratic. So once the Pencil has been seen
on the pages (its first touch is WebKit's: nothing can cancel a touch
already begun), its touches are cancelled there, as ink mode cancels
them, and what a finger does is done for it from its pointer events: a
drag scrolls and coasts (a swipe turns a set in the paged view; pinched,
the magnifier pans, `magnify.ts`); held still for 450ms it selects the
word under it, and moving on without lifting carries the selection's
end along letter by letter (`textPositionAt` in `textHit.ts`, so the
gaps between lines don't throw it); a tap is a click where it landed —
a highlight, a link, a button, or the end of a selection. The selection
bar comes up as for any selection. The non-passive touchstart this
takes is added only once a Pencil has been used. The
click a pen gesture can end in (a desktop pen's) is swallowed, so a
stroke over a link or a highlight doesn't press it. The Pencil's touches are cancelled
(`touchType === "stylus"`) so it can't scroll or select text, and while
it is down every touch is, so a resting hand can't move the page. Those
non-passive touch listeners exist only in ink mode — they make each
scroll wait on the main thread. A pen's eraser button erases whatever
tool is on. The Pencil's double-tap turns the eraser on and off,
whatever Settings → Apple Pencil says (its "last used tool" did
nothing from the pen) — the one eraser of ink mode and the notepad
together (`lib/penTool.ts`: either one's eraser, or the double-tap,
sets it in both; it used to go to whichever the Pencil had touched
last, and the two disagreed); the Pencil Pro's squeeze follows the setting — through `tauri-plugin-pencil` (ported from Hush's: a
`UIPencilInteraction` on the web view, events `tap` / `squeeze` with the
preferred action) and `src/lib/pencil.ts`.

A gesture holds a lot while it lasts — every touch cancelled, page
renders waiting — so it always ends. Its end is heard on the window
(capturing), not only on the pages: re-rendering a page replaces the
element a stroke began on, and the pointer-up could otherwise go nowhere
anyone was listening — which left ink mode cancelling every touch and
the renderer waiting for the pen for good, the viewer dead until the
PDF was closed (reading mode, which re-renders every page as it opens,
made it likely). A pen-down while a gesture is still open ends that one
first (a pen can't be down twice), and a gesture that has heard nothing
for 1.5s (`STALE_MS`) stops holding touches and renders without being
ended, since a Pencil resting mid-stroke may say nothing for a while.

**The system's selection menu.** On the iPad, selecting text in the PDF
also brings up the system's menu (Copy, Look Up, Translate…), over the
viewer's own bar, and nothing on the page can stop it — CSS
(`-webkit-touch-callout`) no longer reaches it. So as a selection in the
PDF's text layer settles, `src/lib/pencil.ts` asks `tauri-plugin-pencil`
to dismiss it (`hide_edit_menu`: WebKit's `UIEditMenuInteraction`, found
among the web view's interactions, `dismissMenu()`; on iOS 15,
`UIMenuController`), and again 400ms later in case it came up after. It
may show for a moment before it goes. Selections elsewhere — the notes —
keep their menu.

Why it keeps up with fast writing:
- *No page re-render per stroke.* Highlights are painted into the pdf.js
  raster (`paint.ts`), which costs a page render per change. Ink on the
  pages is instead an `<svg>` per page (`layer.ts`), its outer group
  mapping PDF space through the page's viewport transform: a stroke is
  one `<path>` appended, an erase rebuilds one annotation's group, and
  the viewBox carries it through every zoom without a redraw.
  `changedPages(…, withInk = false)` keeps ink out of the pages' repaint
  decision. (Thumbnails and the folded view still paint ink into their
  rasters; nothing is drawn there.)
- *A constant cost per sample.* The stroke under the pen is drawn on one
  canvas over the pages (`live.ts`), one curve segment per sample, with
  no layout read (the page's box is read once at pen-down) and no
  redraw; at pen-up it moves into the SVG and its region is cleared in
  the same task. The canvas is allocated when ink mode starts and
  released when it ends — never mid-stroke, which on iPad drops samples
  (Hush measured it). Coalesced events are used off iOS only, as in
  Hush.
- *Nothing written while writing.* A change reaches the store and the
  annotation outbox only once the pen has rested 2s — past the pause
  between two words or two lines, so the write doesn't land on the start
  of the next stroke (or after 15s of
  unbroken writing, at the next pen-up; and at once on leaving ink mode, closing the
  PDF, or the app going to the background — ahead of the push that same
  event starts). Store writes re-render React and outbox writes are IPC;
  either, mid-stroke, would cost the stroke samples. Until then the
  session's changes override the store's copy, so a sync landing
  mid-sentence can't undo it, and the store's echo of a write is
  recognised by its position string and draws nothing.
- *What a write sets off is small.* The changes of one flush (and the
  results of one push) reach the store as one update, so React renders
  once (`upsertItems`, batched in `annotationEdits.ts`). Rebuilding the
  library's annotation index after it reuses the annotation of every
  item the write didn't touch (`normalize` in `lib/highlights.ts`), and
  ink mode keeps each one's parsed drawing with it — so a write no
  longer re-reads every drawing in the PDF. No push starts within 5s of
  the pen writing (`notePenActivity`): its results are a store write too.
- *The pages wait for the pen.* No page render starts while it is down,
  and one under way when it comes down is stopped and started again
  once it lifts (`yieldToPen` in `render.ts`); a page that finished
  meanwhile lays out its text and links only after. pdf.js draws and
  lays out text on the main thread, in slices that would cost the
  stroke its samples.

Measured in Chromium (`npm run dev`, the viewer driven with synthetic pen
events): about 0.01ms of script per pen sample, and under 1ms on average
at pen-up (smoothing, merge, SVG). Hush's stroke engine (tile-baked
canvases, brush atlases) was not needed: Zotero's ink is one width per
annotation with round caps, which SVG draws natively.

An annotation's position may be at most 65,535 characters (the server's
limit); an annotation that would outgrow 60,000 starts a new one, and a
single stroke too long for one is split across several. Not yet done:
Zotero's resize and rotate handles for a selection, moving a drawing to
another page, and drawing in the folded view (ink mode leaves it).

**Notes sync.** Notes save to this device as you type and are pushed to Zotero as a
`NOTES.md` attachment of the entry every couple of minutes while
anything is unpushed, when the app goes to the background, and on
**Close PDF**. Opening an entry's notes (online) first asks Zotero whether
its copy changed, so notes written on another device arrive. Editing
in two places isn't the expected use, so the conflict handling only
promises not to lose words: a version changed in Zotero while this
device has unpushed edits is kept beside the local one as
`<itemKey>.conflict-<time>.md`, and the local text wins. Replacements
are sent with Zotero's `If-Match` md5 precondition, so nothing in
Zotero is overwritten unseen. The sync is `src-tauri/src/notes.rs`.

**Starting a note: the reading questions.** An empty note shows, where
its first line would be, a list of questions to read by:

```
- Who is the author?
- What are their arguments?
- What is the evidence to support these?
- What are their conclusions?

- What are the weaknesses of the arguments, evidence and conclusions?
- What do you think of the arguments, evidence and conclusions?
- How does (or how could) the author respond to these criticisms?
```

It behaves like a placeholder — typing anywhere sends it away — with
more to it. Pointing at it shows **Use** and **Clear** beneath it (always
shown on a touch screen): Use writes every question as a level-3 heading
with a line to write on under each, the caret under the first; Clear
removes the list and keeps it away for that entry (`localStorage`,
`zotero-helper-prompts-cleared`). Clicking a single question starts the
notes with just that one, as a heading with the caret on a new line
beneath it (`headingBlock`).
In any note, a line begun with `?` opens the questions as a menu
(CodeMirror autocomplete; text typed after the `?` filters it), and
picking one turns the line into its heading, the caret again on a new
line beneath it. The questions are
`PROMPT_GROUPS` in `src/noteseditor/prompts.ts`; the list over the empty
editor is `src/components/NotesPrompts.tsx`.

### Highlights

**Highlights** — Zotero's annotations are ordinary items, so every
sync (the full refresh included) already brings them down with the
rest of the library; nothing extra is fetched. When the selection has
any, the right panel gains a **Highlights** tab, a searchable browser
modelled on [Hush](https://github.com/laffan/hush)'s highlight pane: a
filter box that searches highlighted text, comments, page labels and
tags; a column of colour swatches (a click shows one colour, ⌘-click —
Ctrl elsewhere — adds or removes one, as in a file list); and the
highlights in reading
order, each with its page and three small buttons: **Copy** (a
Markdown blockquote with a link back to the page), **Note** (the same
quote, inserted into the entry's notes at the caret — offered when one
entry is selected, since notes belong to an entry) and **Zotero**,
which opens the PDF there on that highlight. Several selected entries, or one with several PDFs, list
under a heading per PDF. When the PDF has an outline (and is open, or
downloaded to this device, where its outline is read from the cached
file), its highlights are filed under the outline's section headings
— the deepest heading at or above each highlight — and headings with
no highlights are left out.

### AI

The AI features — the toolbar's **AI** menu, **Questions** (and
**Explanations**) in the sidebar and the right panel's conversations tab — show only once a
service is connected: a key entered in
Settings → AI for the service chosen there (`aiConnected` in
`src/lib/ai/models.ts`). Without one they are hidden, not disabled;
saved conversations stay on disk and come back with the key, and a
remembered visit to Questions opens All Items instead.

**The conversations tab.** With a service connected, one entry in the
right panel gets a fourth tab (the conversation icon, with a count; Q
from the keyboard): the Questions conversations about that entry alone
(`isAbout`), newest first, with Ask Abstract / Ask Full Paper to start
one (`ItemChats.tsx`). Conversations it was only part of — a selection
or a folder asked about — are listed above as links, which open in
Questions (leaving the PDF). A conversation opens in the tab, in place of the
list, so it can be read beside the PDF; one started while a PDF is open
opens there too, rather than moving the hidden library to Questions
(`confirmAsk`).

**The explainer.** The selection bar's sparkles (shown with a service
connected) open a small window about the selected passage, floating
over the pages at the bottom right — reading mode included — and ask
about it at once, in the words of Settings → AI → Prompts ("What would
the encyclopedia entry for “…” be?" unless changed), of which the
window shows only the passage (the message's `display`)
(`lib/ai/explain.ts`, `ExplainChat.tsx`). There are no follow-ups: a
toggle under the window's head says what goes with the question.
**No Context**, the default: nothing but the question — no page, no
paper — answered under the backend's own system prompt, which explains
the concept on its own terms, as an encyclopedia entry would, in under
100 words (`ai_chat`'s `mode` "explain", `src-tauri/src/ai/chat.rs`);
so there is no cost popup first. **Context**: the work's metadata, the
page the passage was selected on and the text of its PDF, page markers
and all (the whole PDF up to 80 pages, else the 80 pages around the
passage, capped at 120,000 characters; `explainContext`, read with the
same local parser as Ask Full Papers), answered about what the passage
means in this work, in under 120 words ("explain-context"). Switching
asks again, the new answer in place of the old (the cost of both is
kept); the window's foot shows the context's size and what the
explanation has cost. ×, Escape or a press outside it closes the
window. Each is kept as a conversation about the entry (`mode`
"explain", one question and its answer), named after its passage —
but shown as what it is: under Explanations in the entry's
conversations tab, and in **Explanations**, a row between Questions and
Words in the sidebar, never among Questions' conversations
(`ExplanationList.tsx`). Each is a box: the passage as its head, a
link that unfolds the answer beneath it (folded to begin with, and
drawn as a box, background and edge, only while unfolded), an info button that shows when it was asked, by which
model, what it cost, whether with its context and from which work, and
a quieter trash can; the sidebar's list, every document's explanations
newest first, adds under each the work and page, which opens the PDF
there with the passage marked, as Words' source links do, and a filter
box at its top that narrows the list by passage, answer or work. The
explained passage stays marked in the PDF with a dashed pink outline
(`--explain-mark`, an overlay like a citation's, `passageMarks.ts`;
where it is kept as the chat's `passage`), and a tap on it opens its
explainer again — in reading mode too.

**Look up and Words.** The selection bar's magnifier (and the
highlight editor's) asks for a definition of the selected word or
phrase — "Define “…”" unless changed in Prompts, with no context at all,
so the answer is its meaning and nothing about the work — under a
system prompt that keeps it to at most 50 words (`mode` "define"). The
answer shows in a small box over the bar (`lookupPopup.ts`), a one-off
that goes with the selection and is never part of a conversation
(`lib/ai/lookup.ts`). A word looked up from a selection stays
underlined in the pages — dashed, in the explained passages' pink — and
a tap on it shows its definition in the same box, above the word, until
the next press elsewhere or a scroll (`passageMarks.ts`, kept as the
word's `place`: its page and rects; a highlight's text looked up from
its editor has none, so the highlight keeps its own tap, and words kept
before the marks have none either). Each is kept in **Words**, a row between
Explanations and Recent in the sidebar: every word looked up, across all
documents, alphabetically, with its definition and where it was read —
its PDF and page, and the sentence it stood in, which its source link
finds and marks on the way back (`WordList.tsx`, `lib/words.ts`;
`words.json` in the app's data folder, `src-tauri/src/words.rs`). The
same word looked up again in the same PDF replaces the one before.

**Prompts.** Settings → AI → Prompts holds the explainer's and the
look-up's questions as templates — text with tokens in it, shown as
chips, for what is filled in as it is sent: the selection, and the
work's title, authors and year (`lib/ai/prompts.ts`,
`PromptSettings.tsx`). A token is dragged in from the row beneath (a
pointer drag, which works with a finger on the iPad), or tapped to go in
at the caret; Reset puts a prompt back. They apply at once, on this
device (`zotero-helper-prompts` in `localStorage`); the system prompts
around them stay the backend's.

**AI Tidy Metadata** — with an API key configured, selected items are
cleaned up by the model (grounded in a fresh CrossRef record when a DOI
exists): casing, missing abstracts/pages/ISSNs, normalized author names.
Only changed fields are written back. Its sibling, **Get Abstract**,
parses the PDF's first pages locally and has the model lift the
abstract out verbatim.

**Two providers, four models** — Settings → AI picks a service (Anthropic or
OpenAI), takes that service's key, and offers a short fixed model list:
Claude Sonnet 5 or Claude Haiku 4.5, GPT-5.6 Terra or GPT-5.6 Luna. Every
AI feature uses whichever is selected; the per-model prices live in
`src/lib/ai/models.ts`, which is also what the cost estimates are
computed from.

**Questions — chat with your abstracts (or your papers)** — a folder
above Library holding conversations about works in the library. Start one
from any of three places, with the same two buttons: an open folder with
nothing selected, a multi-item selection, or a single item. **Ask
Abstracts** uses the metadata the app already holds; **Ask Full Papers**
downloads each PDF and extracts its text with the same local parser Get
Abstract uses — the model is sent words, never a PDF, and never anything
else about Zotero. Before any of it is sent you get a popup with the
token count and what the first question and each one after it will cost.

Inside a conversation, the works sit at the head of every request and
never change a byte, so after the first call the provider serves them
from its prompt cache at roughly a tenth of the price. That's why the
chat shows a countdown beside the running total: ask again inside the
window (5 minutes on Anthropic, 30 on OpenAI) and the papers are cheap;
let it lapse and the next question pays for them in full. **Share
Conversation** exports the whole thing — exchange *and* source material —
as one Markdown file, so the conversation can be picked up somewhere
else. Answers render as Markdown (GitHub flavour, so a comparison of
five papers arrives as a table).

**Page citations.** Full-text material is fed to the model with page
markers in it, and the model is asked to cite the page a claim rests
on — and, where a specific passage is the point, to quote it exactly.
Those citations come back as inline **See on p. 12** pills with two
buttons: the eye opens the PDF in the app's own reader (downloading it
first if it isn't on this device; in place when it is already the PDF
open), keeps the conversation in front in the right panel's
conversations tab — even one about several works, which that tab
otherwise only links to — and scrolls to the quoted passage, marked in neon pink
(`--cite-mark`) — a colour no Zotero highlight or search hit uses, so
it is never mistaken for one of your own marks. The other opens it in
Zotero's reader at the same page. Which means an answer is checkable —
you can be looking at the sentence it is talking about in one click,
rather than taking its word for it. The search is `lib/pdfQuote.ts`,
run on the viewer's own document; the mark is `pdfviewer/citeMark.ts`,
an overlay drawn like a search hit's, one passage at a time, never
written to Zotero, and gone with the next citation or when the PDF
closes. A citation with no quote just goes to its page. The passage is found by comparing words rather than
characters — anchored on the quote's first and last pair of words,
with the interior words deciding between candidates — so line
wrapping, a word hyphenated across a break, ligatures and stray
spacing never come into it. Where the extractor has spliced the quote
out of two parts of a page — which two-column layouts, title blocks
and copyright footers all cause — the longest stretch of it that is
really contiguous gets highlighted instead, and the view scrolls to
it. Where a passage is quoted, *it* decides
which page you are shown: the cited number is only a hint, searched
around and then across the document, because the number is the part
of a citation a model most easily gets wrong (a paper whose running
head reads "CONSUMING WITH OTHERS 507" invites citing the folio
however plainly you ask for the marker). The search spirals out from the cited
page across the whole document, so a book cited by its printed folio
still lands on the right page; the activity log says which page it
was found on. When it genuinely isn't in the PDF, nothing is marked —
the reader is left on the cited page, unmarked, rather than looking
verified — and the activity log says *why*: the words are nowhere in
the document, or the pages are images with no text layer, or the
sweep hit its cap on a very long PDF. Each conversation lists the works it
covers behind a **View Titles** twirl-down, and every title there opens
that entry in Zotero *inside the folder the question was asked from* —
which is the one that matters for an entry filed in several.
Conversations are named by the model after the first exchange and live
in the app's data dir; nothing about them is written to Zotero.

### Bookmarks

Zotero has no bookmarks, so these are the app's own: `bookmarks.json`
in its data folder (`src-tauri/src/bookmarks.rs`, opaque JSON; the shape
is `Bookmark` in `src/lib/bookmarks.ts`), never sent to Zotero. The
button at the top right of each page in the reader (a bookmark; it
replaced an earlier "cite this page in the notes" pencil) opens a small
box to name it, filled in with the page ("p. 12") and selected: Enter
or Add makes it, Escape or a press elsewhere drops it
(`src/pdfviewer/bookmarks.ts`). On a page that already has one, the
button opens that bookmark instead — its name, to rename (Save) or
Remove. The button shows only with the pointer within 100px of the
page's top-right corner (always on a screen with no hovering pointer at
all); on a bookmarked page it always shows, filled, with the bookmark's
name beside it. In reading mode the button is hidden, and a second's
hold on the page's top-right corner opens the box instead (see Reading
mode). Under a reading crop the corner buttons move in to the
corner of what is shown (CSS on `.pdf-cropped`, from the trim's
fractions), and "near" is measured from the button itself.

The Highlights tab lists bookmarks among the highlights: each is turned
into an Annotation-shaped entry (type `bookmark`, a sort index at the
top of its page, its position the page's top) so reading order, the
search and filing under the outline's headings all apply unchanged —
the viewer's painter never sees them. The colour column gains a
bookmark entry, which filters like a colour (⌘-click to combine). A
bookmark's row (`BookmarkRow.tsx`) goes to its page on a click — in the
open PDF, or opening it there (`openReaderAt` in `ReaderPane.tsx`) —
and offers Rename, Note (a link to the page, into the notes) and Delete
(a second press confirms). A selection with bookmarks but no highlights
still gets the Highlights tab.

### The notepad

A scratchpad for the Apple Pencil, one per PDF, to be typed up into the
notes afterwards (`src/notepad/`, `NotepadBody.tsx`). It shows in two
places, sharing one pad (`notepadFor` / `watchNotepad` in
`model.ts`, so a change in one view redraws the other): floating over
the pages in reading mode, and in the notes pane's lower half.

**In reading mode** (`ReadingNotepad.tsx`) the closed pad is an icon, a
filled red rectangle, at home in the next place down reading mode's
buttons at the left (below the pen, `homeSpot`), which a drag moves
anywhere. While it is dragged, its home shows as a dashed ring (filled
once the icon is within 40px), and let go there the icon settles home
again (kept on this device, `zh-notepad-icon-2` and
`zh-notepad-icon-home`). A tap opens the pad
out of it: the pad grows from the icon's box to its own (`morph`, the
Web Animations API, 260ms), and closing shrinks it back into the icon;
while the pad is open the icon is hidden. The pad opens with the corner
facing away from the window's middle at the icon (its top right for an
icon at the top right; `cornerOf` / `boxAtIcon`), and closes back into
that same corner of wherever it has been moved (`iconAtBox`), so the
icon and the pad keep to one place. A floating pad keeps 20px clear of
the window's left edge, for the quote knob's half that reaches out over
its own. Four-fifths of the window's height
to begin with, its background 90% opaque so the pages show through
faintly; the bar's empty middle drags it, a dotted circle at its corner
sizes it. Let go with the pointer at the window's left or right edge (a
dashed outline shows the edge it would take as it nears) and it docks
there: a full-height column whose width comes out of the pages' room —
it sets `--notepad-dock-left` / `--notepad-dock-right` on `<html>`,
which pad `.reader-pane` in reading mode, so the viewer's
ResizeObserver lays the pages out again (fit modes re-fit; a
side-by-side strip, sized by the height, just shows less of itself),
and move reading mode's buttons, the progress pill and the explainer's
window in beside it. Its inner edge sizes it (up to 60% of the window):
a 16px strip astride the edge, below the bar, and round the grip at its
middle a 44 × 120px target for a finger (the docked pad isn't clipped,
so the handle reaches out over the pages; at the middle it stays clear
of reading mode's buttons beside the pad's top). Its bar pulled 40px
from the edge floats it again under the pointer. Floating or docked,
the one tree stays mounted, so undo and the pan live through the
change; where it sits, its size and the dock are kept on this device.

**Auto-shift.** With two pages side by side — "Fit 2 pages", outside
the folded view, which the viewer reports as the store's `twoUp`
(`onTwoUp`) — the pad's bar gains a button of two pages side by side,
one drawn dashed, on or off (`zh-notepad-autoshift`). On, a press on the pages on
the pad's half of the window — the Pencil's or a finger's; not on the
pad itself — slides the pad to the same place on the other half
(`left` mirrored, a 0.3s slide), so it keeps to the page not being
worked on. A docked pad changes edges instead, once the press is over,
since the pages are laid out again.

**Under the notes**, from **View Notepad** at the pane's foot
(`NotesPanel.tsx`) — the bar between the notes and the pad is the
divider, dragged to share the height, with Hide Notepad at its middle.

Either way it is one continuous surface in the panel's colour: a slim
bar of tools over the canvas — a very faint dot grid, which pans with
it. From the bar's left: the branch (following the PDF), the map, the
host's own tools (auto-shift), the empty middle; then, just before
undo and the host's close, one switch of four parts saying what the
Pencil does: write in the ink of the theme — black, white in the dark
theme (`--notepad-ink`; such a stroke is kept with no colour, so it
follows the appearance) — write in red, the reading-mode red
(`RED_INK`, `#ff5f57`, kept with the stroke), erase, or lasso. The
colour is this device's (`zh-notepad-pen-color`), shared by every view.

The quote knob sits on the pad's edge at its middle, half outside it,
on the side facing the pages (the left; the right for a pad docked at
the window's left; just inside the edge under the notes, whose pane
clips what leaves it): a round bump in the pad's colour with a grey
ring set a little in, which turns the highlight orange (`#f19837`)
while a link is being drawn out of it.

On the canvas the Pencil writes — a tap is a dot — a finger pans, and a
mouse writes with a drag (a Mac has no Pencil) while a wheel pans; each
view pans on its own. Strokes are SVG paths grown sample by sample, as
the viewer's ink is, with no React render under the pen (`surface.ts`).
The eraser — the switch's third part, a pen's eraser end, or the
Pencil's double-tap — takes out every stroke it passes over; the switch
always shows it. It is one eraser with ink mode's on the pages
(`lib/penTool.ts`): turned on or off in either, it is on or off in
both. A
gesture on the canvas always ends: its end is heard on the window,
whatever element it reaches; a pen coming down while one is still open
ends that one first, as does any press once the open one has heard
nothing for 1.5s; a Pencil counts whether or not it is the primary
pointer (a resting palm can make it secondary); and a press on the pad
lets go of a text selection in the pages, which WebKit could otherwise
take the press to end. (Before, a lost pointer-up left the pad deaf to
the Pencil, and the eraser, switched on by a stray double-tap, showed
only as a faint tint on its button — picking a colour went back to the
pen, which is why that seemed to bring the pen back.)

**Selecting, as Hush selects** (`lasso.ts`): the Pencil, a finger or
the mouse held still where it came down for 500ms turns that press
into a lasso — the stroke begun is dropped, and the loop is drawn on
from there, dashed. Let go, it selects the strokes with any point
inside it and the links whose middle is. The selection is framed, with
Delete above the frame; a drag that starts inside the frame moves it
(any pointer), ⌫ deletes it, Escape lets go, and so does a tap on it
or a press anywhere else — the Pencil then writes at once. Held, the
lasso is borrowed for the one press; the switch's fourth part makes it
the tool, when every press of the Pencil or the mouse draws one at
once. Strokes or links selected and then gone some other way — erased,
undone, cleared, changed in another view — leave the selection too
(`prune`, after every change), and with nothing left the frame and its
Delete go.

Strokes written while the reader stays on one page are one note;
turning to another page — even to come straight back — starts the next
(each view counts the visits to the page in view, `NotepadBody.tsx`).
A note remembers where in the PDF the reader was when it began — the
page at the view's centre and the height a quarter of the way down the
view (`placeInView` in `pdfviewer/places.ts`) — and shows that page,
small, above it; a finger tap (or a click) on a note goes back there.
The branch icon (two dots joined by a dotted, stepped line) makes the pad
follow the PDF: as the reader turns pages it glides to the part of the
pad about the page in view — the top of its notes and links, or for a
page with none, between those of the pages before and after it as far
along as the page is, or just under the last (`spotFor` in
`surface.ts`) — supposing the pad is written top to bottom as the PDF
is read. It starts off in the floating pad and on under the notes, and
each view remembers its own.

The quote knob makes a link (`links.ts`): pressed and dragged out onto
the pages, a dashed line running from it to the pointer, and let go
over a highlight or a spot on a page (`placeAtPoint`), it puts a link on
the pad — a link icon and "p. 12", or the whole of the highlight's text
beside a bar in its colour, its page after it at half opacity — to be
dragged where it belongs and tapped to go back there. A highlight's
quote is sized by a small dotted circle at its lower right (the
floating pad's grip, smaller): its width and height are kept with the
link (`w`, `h`), the text wrapping to the width and clipped at the
height. A link held (a long press, or a right-click) opens a small menu
under it with Delete. The menus' buttons act on the release of a press
(`onPress`): the canvas cancels its touches so a finger pans, and that
cancelled the click a tap on them would have ended in — Delete did
nothing on the iPad.

The map icon shows a minimap, a 60px column down the canvas's left
(`minimap.ts`; off to begin with, remembered for each view): the whole
pad small — strokes, and links as bars in their colours — with the part
in view outlined; a tap or a drag on it brings that part into view,
going no further than half a view past what it draws. It fits the pad's
contents and the view together under one SVG transform, so a pan moves
only the outline and the transform, and the strokes are drawn again
only when the pad changes (the surface's `watch`). A faint trash can at
the canvas's lower left clears the pad — strokes, notes and links —
once "Clear the whole notepad?" is answered. Undo takes back the last
stroke, erasing, link, move, deletion or clearing. Kept on this device
(`notepads/<attKey>.json`, `src-tauri/src/notepads.rs`), written a
moment after each change; never sent to Zotero.

### Recent

**Recent** — a row beneath Questions in the sidebar listing the last
100 PDFs opened in the app, the latest first (its own order, whatever
the column sort). It behaves like any folder — list or icon view,
double-click to read — and, like pins, lives on this device only.

### Storage and the activity log

**Cache** — Settings → Cache shows what the app keeps on the device: the
library cache (file size, how many entries, attachments, highlights
and notes it holds, when it was last updated), the **PDF cache**
(total size, each PDF with its size and date, *Clear all* or remove
one), thumbnails (clearable) and reading notes.

**Activity terminal** — a collapsible log row beneath the main columns
records everything the backend does; one tap copies the whole log for
debugging.

## Settings

The settings window (`src/components/settings/`) is an overlay over the
app, centred, with a list of sections at its left — a row of tabs on a
narrow window — and the open section beside it. It keeps to the window:
a long section scrolls inside it. Escape or a press on the backdrop
closes it (like Close, dropping unsaved edits); while it is up the app
beneath is `inert`, so a notes editor still focused there can't take the
iPad's typing.

- **General** — appearance (match the system, light or dark) and the UI
  font size (11–18px; 13 is the size the UI was drawn at). Both apply at
  once and are this device's (`src/lib/appearance.ts`): the theme is
  `data-theme` on `<html>`, which `tokens.css` reads to override the
  system's `prefers-color-scheme`, and the size is the `--font-scale`
  multiplier every CSS font size is written against. PDF pages keep their
  own zoom.
- **Zotero** — the API key (with Verify), the user or group ID and
  library type, and PDF retrieval: the contact email for the
  Unpaywall/CrossRef polite pools and the pause between downloads.
- **Cache** — what the app keeps on the device (see "Cache" above).
- **AI** — the service, its key and the model, and the reader's
  prompts (Prompts, above; these apply at once). Until a key is in, the
  AI menu and Questions are hidden (see "AI" above).
- **Keyboard Shortcuts** — every rebindable shortcut, grouped by where
  it works, plus a list of the built-in ones. See below.

Zotero and AI edit a draft of the stored settings (the Rust core's
`Settings`), committed by **Save**; the footer says when there are
unsaved changes. The other sections act at once.

## Keyboard shortcuts

`src/lib/shortcuts/`. Every shortcut is an action with default keys
(`ACTIONS` in `bindings.ts`); Settings → Keyboard Shortcuts rebinds them
(press a key chip, then the new combo; Esc cancels; × removes a key, +
adds one; "Default" puts an action back), flags a key two actions share
in the same place, and keeps the changes in `localStorage`. ⌘ is Ctrl
off Apple platforms.

Actions belong to a context: **general** ones always listen, then the
**PDF viewer**'s while a PDF is open, else the **library**'s. One
`keydown` listener on the window (`dispatch.ts`) runs after the focused
element's own handlers, so a field, the notes editor or a popup that
spends a key keeps it. Nothing listens on the settings page or under a
modal. While text is being typed — a field, the notes, a comment — only
combos with ⌘/Ctrl/⌥ count; a bare letter, an arrow, Tab or Return there
is typing, and Escape leaves the field. Return or Space on a focused
button presses the button.

Where the focus is therefore decides whether a key is a shortcut, and
iPadOS keeps focus where the desktop lets it go: tapping something that
can't take focus (an item row, a PDF page) leaves the notes or a search
field focused, and every key after it would be typing — the keyboard
seemed dead until that field was unmounted. So a tap outside the focused
text field blurs it, as a click does on the desktop (`noteTapStart` /
`finishTap` in `dispatch.ts`) — once the tap is over (on its click), never
during it, since a blur mid-touch upsets iPadOS's text input. Taps on
controls (buttons, links) leave the field be, as they may be acting on
it, and a drag or scroll (no click) does too.

With a PDF open beside its notes (not in reading mode), the mouse or
trackpad pointer decides between the two (`hoverFocus.ts`): coming over
the pages it lets go of the notes editor and focuses the pages, and
coming over the notes editor it focuses it, the caret where it was.
Before, going from highlighting to writing and back took two clicks
each way on the iPad — the first only moved the focus (WebKit's text
interaction stays with a focused editor, so a drag on the pages
selected nothing). Only the notes editor is let go of, so a highlight's
comment or the search field keep the focus they were given; the
pointer doesn't take the focus into the notes out of another field, nor
while text in the pages is selected (that would end the selection), nor
during a drag.

A field can also keep the focus after it is hidden: fold the right panel
away (⌘⇧\) with the notes focused, or close a highlight's editor from
its comment, and WebKit leaves the focus in a field no one can see (the
spec's focus fixup says it shouldn't). Bare keys then went to the hidden
notes — the arrows, G, 1–3 seemed dead — while ⌘ shortcuts still worked,
until closing the PDF unmounted the notes. So the first listener to see
a key (`rescueKey`, capturing, in `dispatch.ts`) checks whether it is
aimed at a text field that isn't rendered; if so the field lets go and
the key is sent again from the page, so not even that key is lost. The
highlight editor also blurs its comment as it closes, and ink mode's
width slider lets go when released (a range input is never typing).

Underneath that, iPadOS delivers a hardware key to the page only while
WebKit's content view is the first responder, and nothing on the page
can arrange that: wry makes the web view first responder on macOS but
not on iOS, and WebKit promotes it only for a finger tap on editable
text — never for `focus()` from script, nor for a trackpad click. So
without help the shortcuts worked only after the notes had been tapped,
and stopped once the notes let go of focus. `tauri-plugin-keyboard-focus`
(ported from Hush's `KeyboardFocus.swift`) claims the role natively: at
load, when the window becomes key or its scene activates, and when a
keyboard connects — only while a hardware keyboard is attached, and
never while something is presented over the window. The page never asks
for it: becoming first responder marks the page focused, and WebKit can
hand that focus straight back to the field just let go — an earlier
version did ask after every blur, and the notes then fought the page for
the keyboard until taps stopped registering. Losing a focused field
doesn't cost the role, so there is nothing to reclaim.

| Where | Action | Default |
| --- | --- | --- |
| General | Toggle the left sidebar (the outline, while reading) | ⌘\ |
| General | Toggle the right sidebar | ⌘⇧\ |
| General | Focus the search field (the PDF's, while reading) | ⌘F |
| General | Open recent PDF 1–5 | ⌘1 – ⌘5 |
| Library | Show details / highlights / notes | D / H / N |
| Library | Show AI conversations (AI connected) | Q |
| Library | View the PDF | P |
| Library | Next / previous pane (sidebar, list, details) | Tab / ⇧Tab |
| Library | Move in the pane | arrows |
| Library | Extend the selection | ⇧↑ / ⇧↓ |
| Library | Open the folder (sidebar) or item (list) | Return |
| PDF viewer | Show details / highlights / notes | D / H / N |
| PDF viewer | Show AI conversations (AI connected) | Q |
| PDF viewer | Search the highlights | ⌘⇧F |
| PDF viewer | Thumbnail view | G |
| PDF viewer | Toggle the folded view | F |
| PDF viewer | Folded view filters | ⇧F |
| PDF viewer | Open / close the fold under the pointer | E |
| PDF viewer | Horizontal / vertical scroll | Z / V |
| PDF viewer | Fit one / two / three pages | 1 / 2 / 3 |
| PDF viewer | Paged / continuous view | P / C |
| PDF viewer | Draw (ink mode) on / off | I |
| PDF viewer | Sentence tool (a tap selects a sentence) on / off | S |
| PDF viewer | Reading mode on / off (Esc also leaves it) | R |
| PDF viewer | Next page (next fold, when folded) | → or ↓ |
| PDF viewer | Previous page (previous fold, when folded) | ← or ↑ |

H is Show highlights in both the library and the viewer, so the
viewer's horizontal scroll is Z. ⌘1–⌘5 open the first five of the
recent-PDFs menu (the toolbar's PDF name): the PDFs opened lately,
newest first, leaving out the one open — so while reading, ⌘1 is the
PDF read before this one. The menu shows each one's key.

How the actions work (`run.ts`): most press the button already on screen
or set what it sets, so the keys and the pointer can't drift apart. The
viewer's (`src/pdfviewer/commands.ts`, reached through `readerCommand`
in `ReaderPane.tsx`) click the bottom bar's buttons; from horizontal
scroll, a fit key switches to vertical, since the fit buttons only apply
there and in the paged view. Page steps use the same stepper as the
paged view's wheel (`keys.ts`): they count from the page last asked for,
so pressing quickly while a smooth scroll is under way doesn't lose
steps. Fold steps centre the next fold (a fold opened to its page goes to
its top). E opens the fold under the pointer, or the one at the centre
when the pointer isn't over one.

Panes (`panes.ts`): the pane is the one last clicked in, or tabbed to,
and it is outlined (`data-kbd-pane` on `.panes`, `keyboard.css`) only
while the keyboard is moving around; a click clears the outline. In the
sidebar the arrows move a cursor over the folder rows (← / → fold and
unfold) and Return opens the folder; in the list they move the selection
(by rows and columns in the icon view — `listNav.ts`, which the list
registers its order and scrolling with); in the details panel ← / →
switch tabs, ↑ / ↓ scroll and Return goes to the notes.

Built in and not rebindable: the viewer's ⌘+ / ⌘- / ⌘0 zoom, holding ⌃
for trimmed reading, ⌘-click on a line to highlight its sentence, Enter / ⇧Enter in the PDF search, ink mode's ⌘Z /
⇧⌘Z and ⌫ (handled by ink mode itself, outside text fields, so a
field's own undo keeps ⌘Z), and the notes' ⌘I / ⌘B / ⌘= / ⌘K and `?` —
they're listed at the foot of the settings section (`FIXED_SHORTCUTS`).

## Hush integration

"Send to Hush" (toolbar, enabled on selection) is a loose coupling over a
deep link — no shared state, no IPC channel:

1. The picker modal lists Hush's desks/projects by reading the local Hush
   data dir read-only (`{platform data dir}/com.hush.app` —
   `src-tauri/src/hush.rs`). When that's unreadable (iPadOS sandboxing,
   Hush on another machine) the user types names instead.
2. Sending fires `hushwriter://zotero-import?desk=…&project=…&items=…&nonce=…`
   via the `open_in_hush` command (`src/lib/hush.ts` builds the payload:
   a JSON array of `{ itemKey, attKey, title, authors, firstAuthor, year,
   citekey }`, chunked 8 per URL, each chunk carrying a unique `nonce`
   that Hush dedupes on — deep links get delivered to it more than once).
   `project=__active__` targets whatever project is open in Hush's main
   window (the iPad-friendly option, since the desk roster can't be read
   there). Only items with a PDF attachment already synced to Zotero are
   sendable — the link carries keys and display metadata, never
   credentials.
3. Hush's deep-link handler (`src/links/zotero-helper-import.js` in the
   Hush repo, documented in its README-TECHNICAL "Companion-App Deep
   Links" section) resolves the desk/project by id then case-insensitive
   name, registers placeholder PDF nodes, and downloads the binaries
   through its existing background pipeline with its own Zotero API key.

Keep the two ends of the contract in sync when changing either side.

## Building and testing

`npm run build` runs the line check, `tsc` and `vite build`; `npx tsc
--noEmit` and `npm run check:lines` are the quick checks. There is no
automated test suite.

The UI loads in a plain browser too (`npm run dev`): `src/lib/tauri.ts`
then fails backend commands gracefully and the app opens on Settings.
To exercise real screens in a browser, stub `window.__TAURI_INTERNALS__`
(an `invoke(cmd, args)` that answers `get_settings`, `load_library`,
`list_cached_pdfs`, `download_attachment_file` with PDF bytes, and so on,
plus `transformCallback`) before the app's scripts run — e.g. with
Playwright's `addInitScript`. pdf.js 6 calls
`Map.prototype.getOrInsertComputed`, which older Chromium builds lack;
the app's WebKit targets have it, but a test browser may need a polyfill.

### iPad build notes

- Xcode 27 (iOS 27 SDK) needs Tauri 2.12 or later: its `swift build`
  uses the new Swift Build backend, which older swift-rs (pulled in by
  Tauri ≤ 2.11) can't drive, and the build fails compiling Tauri's own
  Swift package against the macOS SDK. The minimum iOS version is 15.0
  (`bundle > iOS > minimumSystemVersion` in `tauri.conf.json`).
- Xcode 27 also builds Swift `@_cdecl` exports as local symbols, which
  swift-rs repairs with `llvm-objcopy` — so `rust-toolchain.toml` asks
  rustup for the `llvm-tools` component — but swift-rs 1.0.8 misses its
  own runtime shim, and a release build fails to link on
  `_retain_object` / `_release_object` / `_string_from_bytes`.
  `src-tauri/vendor/swift-rs` is 1.0.8 with the fix from
  [swift-rs#82](https://github.com/Brendonovich/swift-rs/pull/82)
  (issue [#81](https://github.com/Brendonovich/swift-rs/issues/81)),
  patched in from `src-tauri/Cargo.toml`.

  **Once a swift-rs release includes that fix**, undo the workaround:
  1. delete `src-tauri/vendor/swift-rs`;
  2. delete the `[patch.crates-io]` section (and its comment) at the end
     of `src-tauri/Cargo.toml`, then run `cargo update -p swift-rs` in
     `src-tauri` so the lockfile picks up the release;
  3. delete this bullet (in README_TECHNICAL.md) and the pointer to it in
     README.md's iOS section.

  Keep `rust-toolchain.toml`: swift-rs still needs `llvm-tools` to build
  for iOS with Xcode 27.
- The capture browser works in-app on iPad via a custom plugin
  (`src-tauri/tauri-plugin-capture-view/`): a native WKWebView overlays the
  modal body, PDFs are recognized by response MIME type and downloaded
  through WKDownload *inside the page's own cookie session* (so paywalled
  PDFs come through), and "Grab this page" re-fetches the current URL with
  the webview's cookies. The system-browser + "Attach PDF file…" path
  remains as a manual fallback.
- All networking happens in the Rust core, so there are no CORS issues on
  any platform.

## Roadmap ideas

- PMID / PubMed resolver
- Bulk retraction / duplicate detection
- Per-item attachment browser
