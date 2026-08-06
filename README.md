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
- **Manual PDF rescue** — when the automatic download is blocked (paywalls,
  Cloudflare, …) the row parks in "PDF needs your help" and offers: an
  embedded **capture browser** (desktop: any download or PDF navigation is
  intercepted and attached automatically), the system browser + a file
  picker (the iPad flow), candidate links, or a direct-URL box.
- **AI Tidy Metadata** — with an Anthropic API key configured, selected items
  are cleaned up by Claude (grounded in a fresh CrossRef record when a DOI
  exists): casing, missing abstracts/pages/ISSNs, normalized author names.
  Only changed fields are written back.
- **Re-sync** — incremental sync using Zotero's `?since=` versioning; local
  not-yet-uploaded rows are never clobbered, and remote deletions are honored.
- **Search** — a MiniSearch index over every field (title, authors, abstract,
  tags, DOI, publication, year…), fast enough for thousands of entries on an
  M1 iPad Pro.
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

```sh
npm run tauri ios init   # requires macOS + Xcode; set your dev team in the generated project
npm run tauri ios dev    # run on simulator or device
npm run tauri ios build  # archive for TestFlight/App Store
```

Notes for the iPad build:

- The embedded capture browser is desktop-only (wry download interception
  isn't available on iOS). The rescue modal automatically falls back to
  *open in system browser → save to Files → "Attach PDF file…"*, which uses
  the native document picker.
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
src-tauri/      Rust core (all networking + state)
  src/zotero.rs    Zotero Web API v3: paginated sync, versioned writes,
                   3-step attachment upload (create → authorize → register)
  src/resolve.rs   DOI/ISBN/arXiv/URL → Zotero item data
  src/pdf.rs       Unpaywall + link scraping + validated downloads,
                   per-host rate limiter
  src/ai.rs        Anthropic Messages API (structured outputs) for AI Tidy
  src/capture.rs   desktop capture-browser window (download interception)
```

The library cache and settings live in the platform app-data directory as
plain JSON. The import pipeline is orchestrated from the frontend (one job at
a time; the Rust side enforces per-host politeness delays) so every step is
visible in the UI and the log.

## Roadmap ideas

- Drag-and-drop items between collections
- PMID / PubMed resolver
- Bulk retraction / duplicate detection
- Per-item attachment browser
