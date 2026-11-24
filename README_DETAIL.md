# Zotero Helper

A Tauri companion app for Zotero, built for the things the iPadOS Zotero app
can't do — most importantly **importing DOIs *with* their PDFs** and pushing
everything straight into your Zotero library. Designed primarily for iPadOS,
with responsive layouts for iOS and macOS (and it runs fine on
Windows/Linux desktops too).

![status](https://img.shields.io/badge/status-early-orange)

## What it does

- **Browse your library** — collections, items and an editable metadata
  panel, cached locally and kept in sync with the Zotero Web API.
- **Import identifiers with PDFs** — paste DOIs, ISBNs, arXiv IDs or URLs;
  metadata is resolved, the item is created in Zotero and an open-access PDF
  is found, downloaded and attached. When a download is blocked, a built-in
  capture browser lets you fetch it by hand, and the app learns where each
  publisher keeps its PDFs.
- **Read and annotate** — a PDF viewer beside Markdown reading notes, with
  Zotero-compatible highlights and pen drawings (Apple Pencil on iPad; the
  same ink annotations Zotero's reader makes), a folded view of just the
  annotated passages, a paged view of one to five pages at a time (with
  an adjustable reading crop), a full-screen reading mode, white-on-black
  pages in the dark theme, pinch to magnify, search, outlines and page
  citations into the notes;
  ⌘-click (or the sentence tool) selects a whole sentence, highlights
  can run across a page break and their ends can be dragged, and
  reading mode has a notepad for the Apple Pencil (in the theme's ink
  or red) that links back into the pages and takes clips of them, which
  can be pinned and written over; a double-tap on the notepad (or a
  double-click) types a note there in Markdown, set as Hush's notebooks
  set text. A page, a run of pages or a section
  can be shared as a PDF of its own. **Add Section** (beside the
  sentence tool) draws a labelled dashed line across a page, and the
  Highlights tab files the highlights under these sections — among the
  PDF's own outline headings, or on their own where it has none.
  **Post-its** stick a square of coloured paper on a page, to write on
  with the Pencil or type on; they drag about their page, can be pared
  down by their corners to a sliver kept out of the text — parked at the
  page's edge if need be, and opened whole with a tap — show in the
  thumbnails and a Post-its tab of their own, and reach Zotero as its
  own text and ink annotations, so Zotero shows their words and writing
  too. Widen
  the notes panel and the Highlights tab becomes a **Highlight Map**: the
  highlights on a canvas that pans and zooms (a finger, a pinch, the
  trackpad), in rows for the chapters and columns for the sections within
  them, a long section running on into more columns so that no chapter
  is taller than the screen; its search goes from match to match, and
  the search and colours fade the rest. View Notepad lays the PDF's notepad over the map, and
  its quote button links to the map's cards.
- **AI helpers (optional)** — tidy metadata, extract abstracts, ask
  questions of abstracts, full papers or a part of one with page-cited
  answers, have a selected passage explained in a few lines, with or
  without the work as context (kept in Explanations and underlined in
  the pages), or a word defined (kept in Words and underlined in the
  pages), with prompts you can edit, using Anthropic or OpenAI models.
  A passage of any answer can be selected and clarified: the answer
  opens in a column to its right, level with the passage, which stays
  marked; clarifications nest, and in a conversation each can be
  carried on as a thread of its own.
- **Keyboard first** — rebindable shortcuts for moving between panes, the
  list, the viewer's modes and night vision (Settings → Keyboard
  Shortcuts).
- **Your look** — light, dark or system appearance and an adjustable UI font
  size (Settings → General); and night vision (the eye beside Settings,
  or ⌘⇧R),
  which draws the whole app in red only, with no blue light, for
  working in the dark; the colour dots then show each colour's letter
  (Y, R, G, B, P, M, O; gray has none), and each highlight on the page a tiny flag
  with it, kept in the margin where it can be.
- **Full screen on iPad** — the status bar is hidden while the app fills
  the screen.
- **Continue Reading widgets (iOS 17+)** — home-screen widgets with the
  PDFs read last and the page each was left on, as text or as the page
  itself (highlights and ink included); a tap opens the PDF there, and
  the pin beside each keeps it in its place whatever is read next.

The full feature breakdown, architecture and contributor rules are in
[README_TECHNICAL.md](README_TECHNICAL.md).

## Installation

Prerequisites: [Rust](https://rustup.rs), Node 18+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev        # desktop dev build
```

On first launch, open **Settings → Zotero** and paste a Zotero API key
(created at zotero.org → Settings → Security → API Keys, with library
read/write **and file access** enabled). "Verify" fills in your user ID.
Add a contact email (used for the Unpaywall/CrossRef polite pools — strongly
recommended, PDF discovery is much weaker without it) and, for the AI
features, paste an Anthropic or OpenAI API key (or both) under **Settings → AI**
and pick a model for each task. Save,
and the app downloads your library.

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
npm run ios:widget       # add the Continue Reading widget to the Xcode
                         # project (ios:build and ios:deploy do it when
                         # it is missing, e.g. after `tauri ios init`)
```

`npm run ios:deploy` (see `scripts/ios-deploy.sh`) accepts, after `--`:
`--no-build` (reuse the last .ipa), `--device <udid>` (list devices with
`ios-deploy --detect`), `--debug` (launch with lldb attached),
`--install-only`, and `--export-method <m>` (or the `IOS_EXPORT_METHOD` env
var) to override signing.

Xcode 27 needs Tauri 2.12 or later; the build carries a patched `swift-rs`
— see "iPad build notes" in [README_TECHNICAL.md](README_TECHNICAL.md).

### macOS

```sh
npm run tauri build      # produces a .app / .dmg
```

Regenerate the icon set with `node scripts/gen-icons.mjs` (or replace it
wholesale with `npm run tauri icon <your-1024.png>`).
