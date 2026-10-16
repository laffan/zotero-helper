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
  annotated passages, a paged view of one to three pages at a time (with
  an adjustable reading crop), a full-screen reading mode, pinch to
  magnify, search, outlines and page citations into the notes.
- **AI helpers (optional)** — tidy metadata, extract abstracts, and ask
  questions of abstracts or full papers with page-cited answers, using
  Anthropic or OpenAI models.
- **Keyboard first** — rebindable shortcuts for moving between panes, the
  list, and the viewer's modes (Settings → Keyboard Shortcuts).
- **Your look** — light, dark or system appearance and an adjustable UI font
  size (Settings → General).

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
features, pick a service and paste its API key under **Settings → AI**. Save,
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
