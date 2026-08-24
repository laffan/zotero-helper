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
  cached on disk. A file Zotero holds with no parent entry is its own
  attachment, so it gets a thumbnail like anything else. Both are
  app-side only — nothing is written to Zotero.
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
- **Attachments** — the metadata panel lists every attachment on an item
  (Zotero allows many), each with its own share button. Selecting a file
  that has *no* parent entry swaps the full editor for a short panel —
  name, URL, type, filename, added/modified — because that is all Zotero
  keeps for one; it lists under its filename when it has no title.
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
  glance which entries are ready.
- **The details panel reads as a record.** Fields show their values as
  text — the abstract in full, not squeezed into a five-row textarea —
  and hovering a field's label reveals a small **Edit** link that swaps
  just that field for an input. Save is still the single commit point.
- Multi-select with the usual ctrl/cmd-click and shift-click patterns.
- PDFs are only held in a temp folder during upload and deleted right after —
  the copy of record lives in Zotero (where your iPad Zotero app syncs it).

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
  components/   toolbar, sidebar, virtualized item list, metadata panel,
                terminal, import/rescue modals, settings
  styles/       one stylesheet per UI region (tokens, base, toolbar, …)
src-tauri/      Rust core (all networking + state)
  src/zotero.rs    Zotero Web API v3: paginated sync, versioned writes,
                   3-step attachment upload (create → authorize → register)
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
