# Zotero Helper

A companion app for Zotero, aimed at things the iPadOS Zotero app can't do.
It imports DOIs, ISBNs, arXiv IDs and URLs together with their PDFs, shows
your library with editable metadata, and provides a PDF reader with
Zotero-compatible highlights and Apple Pencil annotations. Optional AI helpers
(Anthropic or OpenAI, with your own key) can tidy metadata and answer questions
about papers. Designed for iPadOS; also runs on macOS, Windows and Linux.

On first launch, open **Settings → Zotero** and paste a Zotero API key (created
at zotero.org → Settings → Security → API Keys, with library read/write and
file access enabled).

## Installation

Download the installer for your system from the
[Releases](../../releases) page: `.dmg` (macOS), `.msi` or `.exe` (Windows),
`.AppImage` or `.deb` (Linux).

The builds are not code-signed. On macOS, if the app is blocked on first
launch, move it to Applications and run:

```sh
xattr -cr "/Applications/Zotero Helper.app"
```

On Windows, choose "More info" then "Run anyway" when SmartScreen warns.

### Build from source

Requires [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri build    # installers end up in src-tauri/target/release/bundle/
npm run tauri dev      # run in development
```

## More detail

[README_DETAIL.md](README_DETAIL.md) has the iOS build steps; [README_TECHNICAL.md](README_TECHNICAL.md) has the full feature breakdown.
