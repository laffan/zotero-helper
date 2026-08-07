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
- **AI Tidy Metadata** — with an Anthropic API key configured, selected items
  are cleaned up by Claude (grounded in a fresh CrossRef record when a DOI
  exists): casing, missing abstracts/pages/ISSNs, normalized author names.
  Only changed fields are written back.
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
  M1 iPad Pro.
- **Send to Hush** — pushes selected items' PDFs into the
  [Hush](https://github.com/laffan/hush) writing app: pick a desk (and
  optionally a project) and Hush downloads the PDFs itself through its own
  Zotero credentials. See "Hush integration" below.
- **Summary select** — selecting multiple items collapses the right panel
  into per-item summary cards (title/authors/abstract by default — the field
  set is configurable from the "Fields" popup).
- **Activity terminal** — a collapsible log row beneath the main columns
  records everything the backend does; one tap copies the whole log for
  debugging.
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
recommended, PDF discovery is much weaker without it) and optionally an
Anthropic API key for AI Tidy. The app then downloads your library and you're
off.

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
  lib/          store, import pipeline driver, search index, actions
  components/   toolbar, sidebar, virtualized item list, metadata panel,
                terminal, import/rescue modals, settings
  styles/       one stylesheet per UI region (tokens, base, toolbar, …)
src-tauri/      Rust core (all networking + state)
  src/zotero.rs    Zotero Web API v3: paginated sync, versioned writes,
                   3-step attachment upload (create → authorize → register)
  src/resolve/     identifier → Zotero item data; one file per source
                   (mod = classify/dispatch, doi, isbn, arxiv, url)
  src/pdf.rs       Unpaywall + link scraping + validated downloads,
                   per-host rate limiter
  src/ai.rs        Anthropic Messages API (structured outputs) for AI Tidy
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

- Drag-and-drop items between collections
- PMID / PubMed resolver
- Bulk retraction / duplicate detection
- Per-item attachment browser
