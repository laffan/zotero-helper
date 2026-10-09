# Zotero Helper

A Tauri companion app for Zotero, built for the things the iPadOS Zotero app
can't do — most importantly **importing DOIs *with* their PDFs** and pushing
everything straight into your Zotero library. Designed primarily for iPadOS,
with responsive layouts for iOS and macOS (and it runs fine on
Windows/Linux desktops too).

![status](https://img.shields.io/badge/status-early-orange)

## What it does

- **Bare-bones Zotero browser** — your whole library (metadata only, no
  attachment files) is downloaded via the Zotero Web API and cached locally:
  nested collections in the left sidebar, items on the right, an editable
  metadata panel on the far right. Columns are resizable; on narrow screens
  the side panels become slide-over drawers.
- **Import IDs with PDFs** — paste a list of DOIs / ISBNs / arXiv IDs / URLs.
  Each identifier appears as a live row in the item list and advances through
  a visible pipeline: *resolve metadata → create Zotero item → find PDF →
  download → upload to Zotero*. Metadata comes from CrossRef (DataCite
  fallback), Open Library / Google Books, arXiv, or Highwire meta tags. PDFs
  are discovered via Unpaywall, CrossRef full-text links, and
  `citation_pdf_url` scraping — all rate-limited.
- **Fetch PDFs for existing entries** — select any items already in your
  library (multi-select works) and run the same PDF pipeline without
  re-creating metadata. Entries missing a DOI get one discovered first via
  CrossRef bibliographic search (strict title/year matching — no match
  beats a wrong match) and the found DOI is written back to Zotero.
- **Manual PDF rescue** — when the automatic download is blocked (paywalls,
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
- **Learned PDF locations** — publishers are consistent with themselves, so
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
- **AI Tidy Metadata** — with an API key configured, selected items are
  cleaned up by the model (grounded in a fresh CrossRef record when a DOI
  exists): casing, missing abstracts/pages/ISSNs, normalized author names.
  Only changed fields are written back. Its sibling, **Get Abstract**,
  parses the PDF's first pages locally and has the model lift the
  abstract out verbatim.
- **Two providers, four models** — Settings picks a service (Anthropic or
  OpenAI), takes that service's key, and offers a short fixed model list:
  Claude Sonnet 5 or Claude Haiku 4.5, GPT-5.6 Terra or GPT-5.6 Luna. Every
  AI feature uses whichever is selected; the per-model prices live in
  `src/lib/ai/models.ts`, which is also what the cost estimates are
  computed from.
- **Questions — chat with your abstracts (or your papers)** — a folder
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
  buttons: one renders that PDF page in the app with the quoted passage
  highlighted, the other opens it in Zotero's reader at the same page.
  Which means an answer is checkable — you can be looking at the
  sentence it is talking about in one click, rather than taking its word
  for it. The passage is found by comparing words rather than
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
  still lands on the right page. The page then says where the passage
  actually was. When it genuinely isn't in the PDF, the page says that
  too, rather than looking verified — and the activity log says *why*:
  the words are nowhere in the document, or the pages are images with
  no text layer, or the sweep hit its cap on a very long PDF. Each conversation lists the works it
  covers behind a **View Titles** twirl-down, and every title there opens
  that entry in Zotero *inside the folder the question was asked from* —
  which is the one that matters for an entry filed in several.
  Conversations are named by the model after the first exchange and live
  in the app's data dir; nothing about them is written to Zotero.
- **Recent** — a row beneath Questions in the sidebar listing the last
  100 PDFs opened in the app, the latest first (its own order, whatever
  the column sort). It behaves like any folder — list or icon view,
  double-click to read — and, like pins, lives on this device only.
- **Re-sync** — the Sync menu offers three scopes: *Sync this folder*
  (fetches only the current collection's changes — the day-to-day option
  for five-digit libraries), *Sync all changes* (incremental via Zotero's
  `?since=` versioning), and *Full refresh*. Local not-yet-uploaded rows
  are never clobbered, and remote deletions are honored. Folder syncs never
  advance the library version, so nothing elsewhere is ever skipped.
  Initial downloads are **resumable**: every page is retried with backoff
  and journaled to disk, so flaky Wi-Fi or iPad app suspension resumes
  where it stopped instead of restarting, and a catch-up pass afterwards
  merges anything that changed during the long download.
- **Search** — a MiniSearch index over every field (title, authors, abstract,
  tags, DOI, publication, year…), fast enough for thousands of entries on an
  M1 iPad Pro. The magnifier opens a mode menu that narrows what a query
  runs against: *all metadata* (the default), *titles*, *authors*,
  *publication*, or a *date range* — two year boxes, either end open-ended,
  which filters on the parsed year instead of running a text query. The
  active mode is the field's placeholder, so the box always says what it
  will search, and results always render as a list whatever view the
  folder is set to (relevance order is invisible in a grid of thumbnails).
- **Share** — one toolbar menu for getting things out of the app: the
  selected items' PDFs (downloaded from Zotero on the spot), a Markdown
  document of titles (linked back to their Zotero entries) and
  abstracts, or **Send to Hush**, which pushes the PDFs into the
  [Hush](https://github.com/laffan/hush) writing app — pick a desk (and
  optionally a project) and Hush downloads them itself through its own
  Zotero credentials (see "Hush integration" below). The first two use
  the system share sheet on iPad (via
  `src-tauri/tauri-plugin-share-sheet/`) and save/folder dialogs on
  desktop.
- **Folder views** — each folder remembers its own local presentation:
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
- **Colored tags** — Zotero's colored ("numbered") tags show as swatches
  before the title in list view and on the caption's second line in icon
  view, up to four per item, in Zotero's own 1–9 order. A tag named with an
  emoji ("📌 to read") shows its glyph instead of the swatch — the emoji
  already says what the color only hints at. The tag button in the view bar
  toggles them; the colors themselves come from the library's `tagColors`
  setting, refreshed on every sync.
- **Flagged folders** — the flag at the left of the view bar lifts the
  current collection into a "Flagged" list pinned above Library in the
  sidebar (the list hides itself when nothing is flagged; unflag from
  either end). Local only, like pins and view modes.
- **Folder menu** — hovering a folder in the sidebar shows a menu
  button at the right of its row: flag or unflag it, rename it (in place; the collection is
  renamed in Zotero), download all of its PDFs to the device, or delete
  it (a second click confirms).
- **Panel buttons** — the two panel icons at the ends of the toolbar
  fold the sidebar and the details panel away and back on a wide
  window, and slide them in as drawers on a narrow one.
- **Attachments** — the metadata panel lists every attachment on an item
  (Zotero allows many), each with its own share button. Selecting a file
  that has *no* parent entry swaps the full editor for a short panel —
  name, URL, type, filename, added/modified — because that is all Zotero
  keeps for one; it lists under its filename when it has no title.
- **Highlights** — Zotero's annotations are ordinary items, so every
  sync (the full refresh included) already brings them down with the
  rest of the library; nothing extra is fetched. When the selection has
  any, the right panel gains a **Highlights** tab, a searchable browser
  modelled on [Hush](https://github.com/laffan/hush)'s highlight pane: a
  filter box that searches highlighted text, comments, page labels and
  tags; a column of colour swatches; and the highlights in reading
  order, each with its page, a copy button (a Markdown blockquote with a
  link back to the page) and **Open in Zotero**, which lands on that
  highlight. Several selected entries, or one with several PDFs, list
  under a heading per PDF. When the PDF has an outline (and is open, or
  downloaded to this device, where its outline is read from the cached
  file), its highlights are filed under the outline's section headings
  — the deepest heading at or above each highlight — and headings with
  no highlights are left out.
- **Reading notes** — every entry has a **Notes** tab holding its
  `NOTES.md`, always open for writing: a CodeMirror editor with the
  Markdown (GitHub flavour) rendered in place — headings, emphasis,
  quotes, code and links show as formatted text, and a line's marks
  reappear only while the caret is on it. Zotero links are drawn as
  small page pills ("p. 22", tinted with the highlight's colour when
  the link names one); a tap follows the link, ⌘-click shows the
  Markdown to edit it. The right end of the tab bar holds the entry's
  PDF: **Download PDF**, then **View PDF**, which turns the sidebar and
  item list into a PDF viewer beside the notes (**Close PDF** brings
  them back). Double-clicking an entry does both at once (an entry with
  no PDF opens in Zotero instead). While the PDF is open the toolbar
  shrinks to what applies to it — **Share** and **Sync** for that entry
  (Sync fetches new highlights and pushes the notes, or downloads the
  PDF again) and the document's name — and the search field finds
  words in the PDF: hits are boxed on the pages, listed under the field
  with their page and a few lines of the surrounding text (a hundred at
  a time, with *Show more matches* below), and stepped through with
  Enter / ⇧Enter; the magnifier turns into a clear button while there
  is a query, and ⌘F returns to the field. ← / → turn the page
  while the pages have focus. A PDF opens on the page it was left on
  (remembered per PDF on this device). When the PDF has an outline,
  a panel button at the left of the toolbar, before Share, shows it
  beside the pages: a folding tree of its headings, each a link to its
  place, with the section being read marked as you go. Widen the notes
  panel past 600px and the Highlights and Notes tabs become one, with
  the highlights beside the notes; narrow it again and they separate. The viewer is a port of Hush's: horizontal or vertical
  scrolling, fit one / two / three pages, zoom, a thumbnail grid, the
  PDF's own links, Zotero's highlights, underlines and ink painted into
  the pages, an annotation shelf with its own filter and colour row, and
  the **folded view**, which collapses the paper to the regions around
  its annotations (when the PDF has red highlights or red ink, those
  alone at first — Hush's "come back to this" colour — with the
  filter button choosing others; highlights made here always fold,
  whatever the filter). It adds what note-taking needs: selectable text with
  an *Add to notes* bubble that quotes the passage, a pencil on each
  page that cites it, and *Add to notes* on every shelf highlight, all
  inserted at the caret with a `zotero://` link to the page. While the
  PDF is open, a faint link icon sits at the left edge of the line being
  written; pressing it heads the line with the page in view —
  `Example note text` becomes
  `[p. 22](zotero://open-pdf/library/items/6M6B2TX9?page=22) - Example note text`
  (after any `- ` / `> ` / `## ` marker, replacing a page link already
  there). Page pills move the open viewer rather than leaving for
  Zotero.

  **Highlighting.** Selecting text in the PDF brings up a small bar
  above the passage (below it only when the passage starts at the top
  of the view), on iPad as on the Mac:
  Zotero's eight colours, a highlight / underline switch beside them
  (remembered between selections), and *Add to notes*. A colour marks
  the passage the way Zotero's own reader does — as an annotation
  item, child of the PDF attachment, with the same position, page
  label and sort-index fields — so Zotero desktop, iOS and the web
  library show it as one of theirs, and the PDF file itself is never
  changed (Zotero keeps annotations out of the file too). Tapping a
  highlight or underline, or the pencil on its shelf row, opens a
  small editor: colour, comment, *Add to notes*, and *Delete* (a
  second press confirms). The mark shows at once; the write goes into
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

  Notes save to this device as you type and are pushed to Zotero as a
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
- **Storage** — Settings shows what the app keeps on the device: the
  library cache (file size, how many entries, attachments, highlights
  and notes it holds, when it was last updated), the **PDF cache**
  (total size, each PDF with its size and date, *Clear all* or remove
  one), thumbnails (clearable) and reading notes.
- **Summary select** — selecting multiple items collapses the right panel
  into per-item summary cards (title/authors/abstract by default — the field
  set is configurable from the "Fields" popup, where the abstract can be
  abbreviated or full; that choice only affects the cards, exports always
  carry the whole abstract). Clicking a card narrows the selection to that
  item, and "Share filtered metadata" exports the cards as Markdown,
  titles linked back to their Zotero entries.
- **Activity terminal** — a collapsible log row beneath the main columns
  records everything the backend does; one tap copies the whole log for
  debugging.
- **Drag items into folders** — drag from the item list (or the icon view)
  onto any collection in the sidebar and the items are filed there; a
  drag that starts on a selected row carries the whole selection. Works
  with a mouse (a few pixels of movement starts the drag) and with a
  finger on iPad (press and hold, so ordinary scrolling still scrolls) —
  pointer events throughout, since HTML5 drag-and-drop is unreliable in a
  WKWebView. Zotero keeps an item in every collection it was added to, so
  this only ever adds: nothing leaves the folder it was dragged from.
- **What we have for each entry** — two marker columns at the right of the
  item list: one for a PDF attachment, one for an abstract on record. Both
  are what the AI features work from, so it's worth being able to see at a
  glance which entries are ready. The PDF mark is filled once that PDF is
  downloaded to this device. Holding ⌘ (Ctrl on Windows/Linux) turns the
  marks into buttons — download on the empty ones, remove on the filled
  — that act without changing the selection; the icon view shows the
  same mark, smaller, at the right of each caption's author line.
- **The details panel reads as a record.** Fields show their values as
  text — the abstract in full, not squeezed into a five-row textarea —
  and hovering a field's label reveals a small **Edit** link that swaps
  just that field for an input. Save is still the single commit point.
- Multi-select with the usual ctrl/cmd-click and shift-click patterns.
- Imported PDFs are only held in a temp folder during upload and deleted
  right after — the copy of record lives in Zotero (where your iPad Zotero
  app syncs it). The one exception is a PDF you download to read beside your notes:
  that copy stays in the PDF cache (`pdfs/` in the app data dir) until you
  remove it from Settings, and while it is there every other reader of
  that PDF (thumbnails, page citations, Ask Full Papers) uses it instead
  of the network.

## Setup

Prerequisites: [Rust](https://rustup.rs), Node 18+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev        # desktop dev build
```

On first launch, open **Settings** and paste a Zotero API key
(created at zotero.org → Settings → Security → API Keys, with library
read/write **and file access** enabled). "Verify" fills in your user ID.
Add a contact email (used for the Unpaywall/CrossRef polite pools — strongly
recommended, PDF discovery is much weaker without it) and, for the AI
features, pick a service and paste its API key. The app then downloads your
library and you're off.

### iOS / iPadOS

One-time setup (requires macOS + Xcode):

```sh
npm run tauri ios init   # generates src-tauri/gen/apple
# open the generated Xcode project once and set your signing team
brew install ios-deploy  # for direct-to-device deploys
```

Day-to-day:

```sh
npm run tauri ios dev    # run on simulator or device with hot reload
npm run ios:deploy       # build a signed .ipa AND install+launch it on a
                         # connected iPad/iPhone via ios-deploy
npm run ios:build        # build only (development signing), no deploy
npm run tauri ios build  # archive for TestFlight/App Store
```

`npm run ios:deploy` (see `scripts/ios-deploy.sh`) builds with
`--export-method debugging` — the right signing for direct installs — then
finds the freshest `.ipa` under `src-tauri/gen/apple/build/` and hands it to
`ios-deploy`. Useful flags (pass after `--`):
`--no-build` (reuse the last .ipa), `--device <udid>` (pick one of several
devices; list them with `ios-deploy --detect`), `--debug` (launch with lldb
attached), `--install-only`, and `--export-method <m>` / the
`IOS_EXPORT_METHOD` env var to override signing.

Notes for the iPad build:

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
  3. delete this bullet.

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

### macOS

```sh
npm run tauri build      # produces a .app / .dmg
```

Regenerate the icon set any time with `node scripts/gen-icons.mjs`
(or replace it wholesale with `npm run tauri icon <your-1024.png>`).

## Architecture

```
src/            React + TypeScript UI (Vite, zustand, MiniSearch)
  lib/          store, import pipeline driver, search index, actions,
                drag-and-drop, PDF-pattern bookkeeping
  lib/ai/       the AI features: toolbar actions (index), the model
                catalog and its prices (models), gathering works to ask
                about (context), conversations (chat), export
  lib/highlights.ts, lib/notes.ts
                annotations out of the library cache; NOTES.md load /
                save / periodic push, the PDF cache
  lib/recent.ts, lib/outline.ts
                Recent and the page each PDF was left on; PDF outlines
                and filing highlights under their sections
  lib/dragGesture.ts
                pointer drags (pane edges, columns, items) that keep
                text selection off while they last
  lib/annotationEdits.ts, lib/pendingAnnotations.ts
                highlights made in the reader: create / edit / delete,
                the push schedule, and unsent changes laid over the
                library until a sync includes them
  components/   toolbar, sidebar, virtualized item list, metadata panel
                and its tabs (Highlights, Notes), reader pane, terminal,
                import/rescue modals, settings
  pdfviewer/    the PDF viewer beside the notes, ported from Hush (viewer,
                render, paint (annotations into the rasters), shelf,
                folds, thumbnails, links, toolbar) plus pageTools (text
                layer, notes hooks), search (find in the PDF), and
                outline (the PDF's bookmarks, resolved to places),
                anchor (keeping the place across a relayout), and
                annotating: selectionBar (colours over a selection),
                annotate (selection → Zotero position, tap hit-test),
                annotPopover (colour / comment / delete)
  noteseditor/  the notes editor: CodeMirror setup, live preview,
                Zotero-link pills, the cite-this-page gutter
  styles/       one stylesheet per UI region (tokens, base, toolbar, …)
src-tauri/      Rust core (all networking + state)
  src/zotero/      Zotero Web API v3: paginated sync (sync), versioned
                   writes, and attachment files (files — create, upload
                   or replace with md5 preconditions, read one item)
  src/notes.rs     NOTES.md on the device and its push/pull with Zotero
  src/annotations.rs
                   the outbox of annotation writes and its push (the
                   HTTP half is src/zotero/annotations.rs)
  src/pdfcache.rs  PDFs kept on the device to read beside notes
  src/storage.rs   the Settings page's storage report
  src/resolve/     identifier → Zotero item data; one file per source
                   (mod = classify/dispatch, doi, isbn, arxiv, url)
  src/pdf/         PDF discovery and download (mod = Unpaywall + link
                   scraping + validated downloads, per-host rate limiter;
                   patterns = learned per-publisher PDF URL shapes)
  src/ai/          model access, one file per concern (mod = provider
                   dispatch, anthropic, openai, tidy, chat)
  src/chats.rs     the Questions conversations on disk
  src/capture.rs   desktop capture-browser window (download interception)
```

pdf.js loads some of what it needs by URL at run time — the
WebAssembly JBIG2 / JPEG 2000 decoders that scanned PDFs depend on,
ICC profiles, standard fonts, CMaps. `vite.config.ts` serves those
directories of `pdfjs-dist` under `/pdfjs/` and copies them into the
build, and `src/lib/pdfjsAssets.ts` hands every `getDocument` call
their URLs.

The library cache and settings live in the platform app-data directory as
plain JSON. The import pipeline is orchestrated from the frontend (one job at
a time; the Rust side enforces per-host politeness delays) so every step is
visible in the UI and the log.

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

## Roadmap ideas

- PMID / PubMed resolver
- Bulk retraction / duplicate detection
- Per-item attachment browser
