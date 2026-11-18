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
                their editable prompts (prompts), export, the
                explainer contexts the provider still has cached
                (contextCache),
                clarifications (threads: a passage of an answer asked
                about, in a column of its own; threadMarks: where each
                passage is in its answer, measured and marked)
  lib/words.ts  Words: every word looked up in a PDF, and where
  lib/bookmarks.ts
                the reader's bookmarks: the store, its file (through
                src-tauri/src/bookmarks.rs), and each as an entry for
                the Highlights tab
  lib/dividers.ts
                the sections the reader adds (Add Section): the store,
                its file (through src-tauri/src/dividers.rs), and
                withDividers, which puts them among the outline's
                headings for the Highlights tab and its map
  lib/postits.ts
                post-its: read out of a PDF's annotations (each one's
                Zotero text and ink annotations, tied by the record in
                their positions), kept by writing those, their colours
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
  lib/appearance.ts, lib/nightVision.ts, lib/panels.ts
                Settings → General's theme and UI font size; night
                vision (the header's eye: the whole app in red);
                showing and hiding the side panels (toolbar buttons and
                shortcuts)
  lib/annotationEdits.ts, lib/pendingAnnotations.ts
                highlights and drawings made in the reader: create /
                edit / delete, the push schedule, and unsent changes
                laid over the library until a sync includes them
  lib/pencil.ts the Apple Pencil's double-tap and squeeze, from
                tauri-plugin-pencil, as a window event for ink mode
  lib/penActivity.ts
                the pen at work, on the pages or the notepad, as one
                signal: how long it has rested, which page renders,
                the notepad's save and the annotation push wait on
  lib/penTool.ts
                the eraser shared by ink mode and the notepad, which
                the double-tap turns on and off
  lib/statusBar.ts
                asking tauri-plugin-status-bar, at boot, whether the
                status bar is hidden (the `status-bar-hidden` class)
  lib/widget.ts the iOS home-screen widget's PDFs and page pictures,
                sent to tauri-plugin-widget; the links it opens with
  components/   toolbar, sidebar, virtualized item list, metadata panel
                and its tabs (Highlights — HighlightRow, one highlight,
                HighlightFilters, the colours and the search's marks,
                both shared with HighlightMap, the wide panel's map,
                and MapNotepad, the notepad over it —
                PostItsPanel, the Post-its tab —
                Notes — NotesPrompts is an
                empty note's reading questions), reader pane (and
                ReadingModeExit, reading mode's way back and its
                buttons; ExplainChat, the explainer's window, and
                ExplainContextMenu, its In Context menu;
                ChatBubble, a question or an answer (Markdown, its
                citations as pills, its passages asked about marked);
                ThreadStrip, a conversation's columns — its own, then
                its clarifications' — and ClarifyPopover, the bar a
                selection in an answer brings up;
                ExplanationList, the explanations as boxes, and the
                sidebar's Explanations;
                NotepadBody, a view of the notepad, and ReadingNotepad,
                its floating or edge-docked window; AskAbout, the
                conversations tab's way to start one; ReaderShare, the Share menu's parts of the open
                PDF; PdfParts, the dropdowns both pick a section or pages
                with), WordList (Words), terminal, import/rescue modals
  notepad/      the notepad: model (notes, links, storage, the pad
                shared between views), surface (the Pencil writes, a
                finger pans), ink (the strokes, on one canvas the size
                of the view), geometry (paths, hit tests), links (the
                links' chips, their sizing, pins and menu, and clips),
                lasso (a long press selects), follow (the part of the
                pad about a page, and the glide there), noteLabels (each
                note's page above it), clip (clip mode over the pages),
                minimap (the whole pad, small), texts (notes typed in
                Markdown: the editor, the double-tap, a note's taps),
                markdown (their Markdown, read as Hush reads a text
                shape, set as DOM), history (what undo takes back, and
                taking it back)
  highlightmap/ the Highlight Map: layout (a PDF's highlights in rows
                for its chapters and columns for what each is divided
                into), view (the canvas, panned and zoomed: a finger,
                the mouse, a wheel, a pinch; the glide to a card) and
                drop (a link let go over a card)
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
                anchor (keeping the place across a relayout), place
                (the reader's place, kept through resizes and the
                app's trips to the background), navigate (going to
                a page, a place on one, a search hit),
                tooltips (the toolbar's, drawn for iPad), keys (zoom
                shortcuts and the page stepper), commands (the
                keyboard's viewer commands: modes, page and fold
                steps), crop (the paged view's trimmed reading),
                citeMark (an AI citation's passage, marked), passageMarks
                (the passages the AI explained, the words looked up),
                excerpt (pages cut into a PDF of their own, a page's
                region as an image), darkPages (the pages white on
                black), pencilFinger
                (the Pencil out of ink mode, a finger), bookmarks (the
                pages' bookmark buttons and marks), bookmarkHold
                (reading mode's hold on a corner), nameBox (the box
                that names a bookmark or a section), dividers (Add
                Section: a section's line placed, drawn, dragged,
                renamed), postits (post-its: placed, drawn on their
                pages, dragged, their presses), postitInk (writing and
                erasing on one), postitEdit (a post-it's menu and its
                text editor), postitCrop (one pared down by its
                corners, and its two places), postitMove (one dragged by
                its grip), postitPaint (post-its painted into the
                thumbnails, folds and clips), places (where the
                reader is, what is at a point — for the notepad), and
                annotating (the pieces below, put together):
                selectionBar (colours over a selection),
                annotate (selection → Zotero position, tap hit-test),
                annotPopover (colour / comment / Explain / delete),
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
                its presses open), clock (the clock beside it, and the
                reading timer it turns into), magnify (the
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
                highlightmap = the Highlight Map;
                pdfviewer-dark = dark pages; pdfviewer-sections =
                the reader's sections on the pages; postits = post-its,
                on the pages and in their tab; explanations = the
                explanation boxes; notepad-clips = the notepad's pins
                and clips, and clip mode; notepad-texts = its text
                notes and their editor; notepad-notes = the pad under
                the notes, its bar and its full-height and full-screen
                places; explainer = the explainer's
                window and its In Context menu; threads = a conversation's
                columns and the passages marked in its answers)
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
  src/share.rs     staging files for the share sheet (an attachment, a
                   text, a PDF made in the webview) and the desktop's
                   exports
  src/bookmarks.rs the reader's bookmarks on disk (bookmarks.json)
  src/dividers.rs  the reader's sections on disk (sections.json)
  src/capture.rs   desktop capture-browser window (download interception)
  tauri-plugin-capture-view/, tauri-plugin-share-sheet/,
  tauri-plugin-keyboard-focus/, tauri-plugin-pencil/,
  tauri-plugin-status-bar/, tauri-plugin-widget/
                   the app's own iOS plugins: the capture browser's
                   WKWebView, the share sheet, handing the web view
                   the hardware keyboard (first responder), the
                   Apple Pencil's double-tap / squeeze, the app
                   full screen (the status bar hidden), and the
                   home-screen widget's data and links
  ios-widget/      the Continue Reading widgets (WidgetKit, SwiftUI),
                   an app extension added to the generated Xcode
                   project by scripts/ios-widget.mjs
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

### Night vision

The eye in the header, to the left of Settings, draws the whole app in
shades of pure red — no blue and no green light — for working in the
dark without losing dark adaptation (the rods that see at night are
nearly blind to deep red). Each pixel keeps its brightness (its
luminance) and loses its hue. It lies over whatever is on screen:
either theme, dark pages or not, the library, the reader, reading mode,
Settings and modals. The choice is this device's and lasts until it is
turned off (`nightVision` in the store's persisted UI prefs, applied
before the first render by `initNightVision`, `src/lib/nightVision.ts`).
Reading mode hides the header, so it is turned on or off outside it.
The Continue Reading widgets follow it (see Continue Reading, above).

**Telling the colours apart.** In red alone the highlight colours look
alike, so while night vision is on each colour carries a letter
(`colorLetter`, `src/lib/highlights.ts`): Y, R, G, B, P, M (magenta)
and O; gray, whose G would be green's, has none and is left unmarked.
A colour another client chose takes the letter of the nearest of
Zotero's. The letters are white, but black on yellow and orange, which
night vision draws nearly as bright as white (the higher contrast for
each colour once all are shades of red), and always fully opaque: in
the Highlights tab's filters a colour not chosen is faded in its fill
rather than with `opacity`, which would fade its letter too, and its
letter is white in the dark theme and black in the light one, whichever
stands out against the panel it is faded towards. The colour
dots show it —
the selection bar's and the highlight editor's, the pen's, the
Highlights tab's filters and reading mode's pen colours — through a
`data-letter` attribute and `nightvision.css` (`::before`, or `::after`
where the dot itself is drawn by `::before`). On the pages each
highlight and underline gets a tiny flag with its letter
(`src/pdfviewer/colorFlags.ts`, run through `annotating.ts`): a plain
tab of its colour (no border or rounding), the height of its line,
attached to the passage. It sits on a layer over the page wrapper in
percentages of the page, like the passage marks, so it follows every
zoom; the letter's size and the tab's side room come from the line's
height in CSS (`--lh`), through `--fk`, the layer's CSS px per page
unit, which a `ResizeObserver` keeps. A flag is kept off the text where
it can be: it goes on the left edge of the first of the passage's lines
that begins a line of text (the first line if the passage begins one,
else the second); failing that, on the right edge of a line that ends
one; failing that (one line with words on both sides, which is rare),
on the passage's own left edge, over the words before it. A line of
text is a run of the page's text items (read with
`pdfQuote.ts#textItems`, once a page, only in night vision) with no gap
wider than the line's height, so on a two-column page the flag goes in
the gutter, not over the other column. Flags that would meet are moved
apart along the line, and kept on the page. With no text (a scan) a
flag goes at the passage's left edge. The flags never show outside
night vision: they are built only while it is on (a class watch on
`<html>`), taken down when it ends, and hidden by `nightvision.css`
unless `<html>` has its class; they are drawn again when the
annotations change or a page is drawn. The folded view and the
thumbnails have none; a reading crop that trims the margin can cut a
margin flag off.

Two click-through layers on `<body>`, over everything else
(`nightvision.css`, z-index 2147483646 and 2147483647 — above modals,
the notepad's link line and the drag ghost): `backdrop-filter:
grayscale(1)` (what is under it reduced to its luminance), then pure red
with `mix-blend-mode: multiply` (that grey times (1, 0, 0): luminance in
the red channel, green and blue zero). Whatever the grey layer misses is
still multiplied, so nothing keeps any blue. They are children of
`<body>` rather than of one host, which would be its own stacking
context and leave both sampling an empty backdrop. Only filter
functions and a blend mode: an SVG `url()` filter would do it in one
step, but WebKit renders those off its accelerated filter path
(unreliable over composited layers such as the page canvases) and
doesn't take them in `backdrop-filter`. Not covered: what the system
draws (the status bar, the keyboard, menus and share sheets, text
selection handles), and the home-screen widgets.

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
(`lib/statusBar.ts`); `base.css`, `readingmode.css`, `notepad.css` and
`notepad-notes.css` keep the band only under `.ipados:not(.status-bar-hidden)`. Off the iPad
nothing changes.

### Continue Reading: the home-screen widget (iOS)

Two widgets for the iPad's (and iPhone's) home screen that pick up
where the reader left off, each in three sizes — small: the PDF read
last; medium: the last two, side by side; large: the last three,
stacked (`src-tauri/ios-widget/`). **Continue Reading** shows each as
text: its title, author and the page it was left on ("p. 12 of 30"),
with a bar for how far through that is. **Continue Reading — Page**
shows the page itself, as the app last drew it, the reader's highlights
and ink on it: a card of the page with the title and page over its foot
(small, medium), or the page beside the title, author and page (large).
A tap opens the app on that PDF at that page — anywhere on a small
widget, each PDF's own part of a larger one. Until something has been
read, a line says so.

Where the data comes from. A widget runs apart from the app and can't
ask it anything, so the app writes what the widgets show into an app
group both belong to (`group.com.laffan.zoterohelper`), and has them
drawn again (`WidgetCenter.reloadAllTimelines`, which doesn't count
against WidgetKit's budget while the app is in front). The page decides
what (`lib/widget.ts`): Recent's first three PDFs still in the library,
each with its title, creator summary, the page it was left on, and its
page count once it has been open here (kept on this device,
`zh-widget-page-counts`); and a picture of the open PDF's page, drawn
afresh from the PDF 480px wide with the highlights and ink painted in
(`pageImage` in `pdfviewer/excerpt.ts`), once a page has been read for
4s with the pen at rest, after a highlight or drawing changes the
library, and as the app goes to the background — the last chance to
show the page it is left on. Each picture is sent once, the list
whenever it changes. `tauri-plugin-widget` (its Swift side) writes them
as `widget/recent.json` and `widget/<attKey>.jpg` in the group's folder,
letting go of the pictures of PDFs no longer among the three; the
widgets read them when WidgetKit asks (a timeline of one entry, never
refreshed by itself). In the browser and off iOS none of this runs.

Night vision. While the app is in night vision the widgets are too:
`recent.json` carries `nightVision`, sent with the list and at once
when it is turned on or off, and the widgets draw everything — text,
the pages' pictures, the background — reduced to its brightness and
multiplied by the display's own red (`nightVision` in
`ContinueReadingViews.swift`: `grayscale(1)`, then `colorMultiply` by
P3 red), as the app does with its two layers. The pictures themselves
are kept in colour, so the widgets come back in colour as soon as night
vision is turned off.

The links. The widget opens `zoterohelper://open?item=…&att=…&page=…`
(the scheme is in `Info.ios.plist`'s `CFBundleURLTypes`); the plugin
keeps the last one until the page takes it (`take_open_url`) and says
when one came (the `open-url` event); the page opens that PDF at that
page (`openReaderAt`), waiting for the library if it hasn't loaded.
A link that reaches the running app comes as tao's `Opened` event. A
link that launches the app doesn't: under the scene lifecycle it comes
in the new scene's connection options, which tao (0.37) reads nothing
from. So `catch_launch_url`, called in `lib.rs` between building the app
and running it — after tao has declared its `AppDelegate`, before UIKit
asks it anything — wraps that delegate's
`application:configurationForConnectingSceneSession:options:`, which
UIKit calls with the same options before the scene connects: the links
are kept, then tao's own answer is given (`objc2`, in the plugin's
`launch` module).

Setting it up. The extension is a target of its own in the Xcode
project, which Tauri generates (`tauri ios init`) and the repository
doesn't keep, so `scripts/ios-widget.mjs` (`npm run ios:widget`) adds it
to the generated XcodeGen spec (`gen/apple/project.yml`) and makes the
project again with XcodeGen: the `ZoteroHelperWidget` app extension
(`<identifier>.widget`, iOS 15, built from `ios-widget/Sources`, its
Info.plist and entitlements made by XcodeGen), the app embedding it, and
the app group in both targets' entitlements — in the spec, as each
target's `entitlements: properties`: XcodeGen writes a target's
entitlements file from those properties every time it makes the
project, so an app group written into the app's file itself (as the
script first did) was wiped by its own `xcodegen generate`, and the app
was signed without it. `--if-needed` runs it again when either the
widget or the app's group is missing from the spec. Making the project again
would drop a signing team chosen in Xcode, so the script writes the
team into the spec for both targets — `APPLE_DEVELOPMENT_TEAM`,
tauri.conf.json's `bundle > iOS > developmentTeam`, or the one the
project already had. `npm run ios:build` and `npm run ios:deploy` run it
whenever the spec lacks the widget (after a fresh `tauri ios init`,
which writes the spec anew). Signing needs the App Groups capability for
the team, which automatic signing registers; this is generally said to
need a paid Apple Developer Program membership (not checked against an
official statement). None of the native side could be built here (no
Xcode); the page's side was checked in a browser with the plugin stubbed.

When it shows nothing. Each part says where the chain stops. The app's
log (the terminal) says, once each time it changes, how many PDFs the
widget lists and the shared folder they were written in — or why they
weren't: "The app group … isn't available to the app" means the app's
own signature lacks the entitlement. (The native side answers `update`
with `{ listed, folder }`. A bare `invoke.resolve()` reaches Rust as
`null`, which `run_mobile_plugin` can't decode into a struct, so every
update used to read as a failure, even one that had worked.) An empty
widget says which case it is: the normal line when the app has listed
no PDFs; "hasn't written anything for the widget yet" when the folder
is there but holds no list (the app hasn't run since, or can't reach
the group); "can't reach the app's shared folder" when the widget's own
signature lacks the group; "couldn't be read" for a list it can't
decode. Whether both signatures carry the group can be seen in the
built `.ipa`, on the Mac:

```sh
IPA=$(ls -t src-tauri/gen/apple/build/*/*.ipa | head -n 1)
rm -rf /tmp/zh-ipa && unzip -q "$IPA" -d /tmp/zh-ipa
APP="/tmp/zh-ipa/Payload/Zotero Helper.app"
codesign -d --entitlements - --xml "$APP" | grep -o 'group\.[a-z.]*'
codesign -d --entitlements - --xml "$APP/PlugIns/ZoteroHelperWidget.appex" | grep -o 'group\.[a-z.]*'
```

Each should print `group.com.laffan.zoterohelper`. `npm run ios:deploy`
makes this check itself after building, and says which of the two was
signed without the group.

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

**Ordering the pinned** — pinned items follow the folder's sort until
one is dragged among them: the same drag that files items into a folder
(a few pixels with a mouse, a press held still with a finger), begun on
a pinned item and taken over another, draws a line before or after it —
above or below a row, left or right of a cell, by which half the pointer
is over — and letting go there moves it (the pinned among the dragged
go as a block; `setPinMover` in `lib/dragdrop.ts`, the order worked out
in `ItemList.tsx`). From then on the folder keeps that order
(`FolderView.pinsArranged`, the order being `pinned`'s), a new pin goes
last, and unpinning an item drops its place: pinned again, it comes
last. With none left pinned, the folder's sort takes over again. Not
while searching, whose order isn't the folder's. Kept with the folder's
view, on this device, from one session to the next.

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

**Part of the open PDF.** While a PDF is open the menu adds, below a
rule, **Share visible pages**, **Share pages…** and, when the PDF has
an outline that points into its pages, **Share section…**
(`ReaderShare.tsx`). The visible pages are every page whose top and
bottom are both in view, and at least half of it across — a spread of
pages side by side, a paged set, the whole rows of a grid of them —
from the first to the last (`pagesInView` in `pdfviewer/places.ts`,
the viewer's `visiblePages`); a reading crop counts only what it
leaves of a page, and when no page is whole (zoomed in, a page taller
than the view) it is the page at the view's centre. They are measured
again as the entry is pressed. Pages and Section unfold, in the menu,
the dropdowns Ask About uses (`PdfParts.tsx`): a first and a
last page (the visible pages to begin with), or a section with its pages,
and a Share link under them. The pages are cut out of the open document
by pdf.js's `extractPages` (`pdfviewer/excerpt.ts`), so the text stays
text, sent to the Rust core as base64 (`stage_pdf_for_share` in
`src-tauri/src/share.rs`) and shared as a PDF named after the entry's
own and the part: "close-reading (pp. 4–9).pdf", "close-reading
(Methods, pp. 4–9).pdf".

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
panel's width and whether it is shown, the Highlight Map's pan and zoom,
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
place, with the section being read marked as you go. With the thumbnail
grid open beside it (G), a heading picked also scrolls the grid to its
page and marks that page (`reveal` in `thumbnails.ts`, from the
navigator's `positioned`). Beside its ×, a
pair of chevrons opens every section, or, with every section open,
folds them all (it is absent when the outline has no nested
headings). The notes panel's left edge widens it as far as the reader
likes — up to the whole window but the edge itself, to drag it back by
(`PaneResizer` in `App.tsx`; it is held to the window's width when the
window shrinks). A tablet-sized window, 600–900px wide — the iPad's half
of the screen, where the library's panels are drawers — keeps the notes
in the row with their edge (it used to hide the edge there, so the
panel couldn't be sized at all): 45% of the window until the edge is
dragged, then the width it was dragged to, kept apart from a wider
window's (`notesWidthNarrow`, per PDF like the other), so going between
full and half screen finds each as it was left. Where fingers point the
edge takes presses 10px either side of it. Widen it past 600px and the Highlights tab becomes the
**Highlight Map** (see Highlights, below); narrow it again and it is the
list. The
viewer's bottom toolbar draws its own tooltips — after a moment's
hover, or on a press-and-hold with a finger, which then doesn't press
the button — since iPadOS shows no `title` tooltips; a button with a
keyboard shortcut shows the key after its text, dimmed, as currently
bound (`data-shortcut` on the button, read by `tooltips.ts`). The bar
is in sections 14px apart — reading mode and dark pages, pages per
screen (fit one / two / three; four and five from the keyboard only,
4 and 5 — the three-page button is lit then, the number over its
last page, `.pdf-fit-more`), scroll direction, paged / continuous,
folding, zoom (−, the zoom or fit, and + as one bordered group), the
sentence tool, Post-it and Add Section (see Post-its and Sections,
below), the pen — and, at
its right, where the reader is:
"54% | 7 of 13 | 1:33pm" (the share of the document up to the page in
view, then the page, or the set's range, "7–9 of 13", then the time).
A press on the place shows every page at a glance, the thumbnail grid
(G from the keyboard; `createPageFinder` in `readingProgress.ts`); a
press on the time, a button of its own, opens the reading timer
(`clock.ts`): a little window over the time, its arrow pointing down at
it, with For (hours and minutes) or Until (a time of day; one already
past today is tomorrow's) and Start. While the iPad's keyboard covers
it (the visual viewport ends above it) the window moves up out of its
way, without the arrow. A press outside, Escape or the time again closes
it. While a timer runs, the time's place counts down in whole minutes,
rounded up ("1 h 25 min", "2 min" — no seconds), in the clock's own
weight and colour, and a press opens the window again with when it ends and
Cancel Timer. At zero a modal in the middle of the window says "Time’s
up", with what the timer was ("25 min", "until 1:33pm") and when it
ended, and its OK (or Enter, Escape, a press beside it) puts the clock
back; until then the count shows "0 min" in red. The end has a timeout of
its own, apart from the clocks, so the alert comes with no PDF open too,
and one that came while the app was put away shows as it comes back.
There is one timer for the app, on this device (`zh-reading-timer`): it
carries on through switching PDFs and closing the app, and every clock
shows it — reading mode's pill too. The last For is remembered
(`zh-reading-timer-last`). One ticker updates the clocks, as the
count's or the clock's minute turns. The viewer is a port of Hush's: horizontal or vertical
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
between the pages as one strip and a set at a time — one to five
pages, as the fit buttons (and the 4 and 5 keys) say, in either scroll
direction (`pdfviewer-paged.css`).
The set is fitted whole and centred (the page indicator shows its
range, "7–9 / 13"), and a swipe moves to the next set — left/right
with horizontal scrolling, up/down with vertical — one set per swipe
however hard the flick (CSS scroll snapping, so the renderer and
everything over the pages is unchanged). A mouse wheel notch or a
trackpad swipe turns one set too, as do the arrow keys; zooming in goes back
to continuous, since pages larger than the view have no single place
to rest. Going to a page or a set scrolls the scroll area and nothing else
(`scrollAreaTo` in `anchor.ts`), placing the set from the area's own
scroll-padding: `scrollIntoView`, used before, also scrolled the
viewer's `overflow: hidden` frames whenever anything overflowed them,
by the set's padding — large with two or three pages to a set — and
nothing scrolled them back, so changing the page count (in reading
mode, by its shortcut) left the pages shifted up over a grey band,
still there after leaving reading mode. The two frames are also pinned
at 0 (`pinFrames`), whatever else might scroll them. Switching scroll direction keeps the page in view, and a
resize (reading mode in or out, a panel opening) keeps the set: the
one shown when it began is put back, centred, once the pages are laid
out again (`watchResize` in `anchor.ts` — the browser may otherwise
settle on the neighbouring set, and WebKit may not snap again at all,
leaving the set off-centre); side by side, the view is never left
scrolled vertically. Going to the background keeps the place too
(`place.ts`). The pages' scroll offset can't be trusted then: iPadOS
lays the app out at its multitasking sizes for its snapshots (and the
status bar plugin toggles the band at the top as the window's geometry
changes), the native scroll view behind the scroll area can move or
clamp the offset, and coming back the page may show before it has its
size again. At a compact width the outline (250px) and the notes panel
take all the room, and fitted at a scale of 0 every page was laid out
0px, the offset clamped to 0, and the place, measured again from that,
page 1 — and in other orders, the last page. A large PDF may also come
back with its layers thrown away and redrawn (the pages blink), and
the native scroll view rebuilt. So the place is a record of its own
that only the reader moves. A scroll counts when it was meant: an
input anywhere (a touch, a pointer, a wheel, a key) or a navigation
(`navigate.ts` — a page, an outline entry, a search hit, a cited
passage, however long after the click it lands) makes the scrolls of
the next 1.5s the reader's, and each one carries that on (momentum, a
smooth scroll). While a finger, the Pencil or a mouse button is down on
the pages, every scroll is the reader's, for as long as it is down, and
the lift is an input of its own (the momentum after it): a drag that
rested a while and then went on used to outlast the 1.5s its first
touch gave it, its later scrolls counted as nobody's, and the view went
back to where the finger had rested as it was let go. Fingers are
counted from touch events — a touch that becomes a scroll has its
pointer cancelled at once — and only presses that begin on the pages
count, so a pane's edge being dragged is still a resize. And it counts
only while the view is undisturbed: a
resize, the window losing focus (the app switcher, Stage Manager), the
app being hidden and the 0.7s after it comes back disturb it, and so
does a scroll area of another size than when the place was last taken
(a frame delivers its scroll events before its resize observations);
an input ends a disturbance. During one, a relayout keeps the kept
place, the saved view records it and no page change is reported. Once
it is over, and whenever a scroll nobody asked for leaves the pages
somewhere else, the view is put back on the place; after a trip away
the offset is also written again (a pixel off, then back, over two
frames), so WebKit hands the native scroll view the position even when
the page's own offset never moved. Nothing is laid out while the app
is hidden — the relayout waits for it to come back — and a view with
no room for a page at least 48px each way keeps the pages as they were
(`roomToFit` in `layout.ts`). Finding the first page in view halves
its way there, so a long book measures a dozen pages per scroll, not
all of them. The activity log, at debug level, notes the place as the
window is left and the app hidden, resizes while it was away, the
return, and any putting back ("Reader: …").
It adds what note-taking needs: selectable text with
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
there). Pressed and dragged out onto the pages instead (`startPress` in
`citeGutter.ts`), a dashed line runs from the icon to the pointer — the
notepad's quote button's line, see The notepad — and let go over a
highlight or a spot on a page, or a card of the Highlight Map, the line
is headed with a link to that:
the highlight itself (`…?page=22&annotation=KEY`, so the pill takes its
colour and following it selects the highlight), or the page the spot is
on; let go anywhere else, nothing is added. Page pills move the open viewer rather than leaving for
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
size and spacing: a red page with a dashed line across it readies Add
Section (the next tap on a page draws a section's line there — see
Sections), a red caret toggles the sentence tool (a tap selects the
sentence under it — see Highlighting), a red pen toggles ink mode (the
Pencil writes, or selects and highlights like a finger) and a red square
of paper, its corner turned up, readies Post-it (the next tap on a page
sticks one there — see Post-its); then the notepad's icon. All four
show white on red while on — the same 28px square behind each, whatever
its glyph's size — and are the viewer's own state (its
`onSectionTool` / `onSentenceTool` / `onInkMode` / `onPostItTool`,
reflected in the store), so the bottom bar's buttons and the keys agree
with them. With ink mode on, a dot on
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
Post-it, in the next place down the left, a filled red rectangle is
the notepad's icon, dragged anywhere, which opens it (see The notepad).
The pages'
bookmark buttons are hidden in reading mode (a bookmarked page still
shows its filled button and name): holding a page's top-right corner
still for a full second opens the bookmark box for that page instead —
the button comes up under the finger and fills as the second counts —
to name a new bookmark, or rename or remove the one there
(`bookmarkHold.ts`; while the press lasts the page's text can't be
selected, so the iPad's own long press doesn't start under it). The bottom bar's page
indicator ("54% | 7 of 13 | 1:33pm") floats at the bottom centre of the screen, 20px
up, and a press on the place opens the page picker (a press on the time,
the reading timer) — the thumbnail grid as a
popup over the pages, the page being read marked and in view, with the
PDF's outline (when it has one) as a column at its left, the section
being read marked (over the notepad and reading mode's buttons); a
thumbnail or a heading goes there and closes it,
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
hidden and the class does nothing, so the pages are as printed. Night
vision (below, Features) lies over either.

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
never during writing: no page render runs while the pen writes (see
"The pages wait for the pen" under Drawing), since pdf.js draws on the
main thread, in slices, and would cost the stroke samples.
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
for a finger; the highlight editor is wide enough for them so spaced —
202px, 242px with a touch screen's larger swatches), a highlight / underline switch beside them
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
small editor: colour, comment, the same Copy / Add to notes / Look up /
Explain icons (the last two with an AI service connected; Explain as
under AI), and *Delete* (a second press confirms) — and puts a handle at each end of the passage,
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
once). A tap that something else has already answered selects nothing
either: the press that slides reading mode's notepad to the other page
(Auto-shift, under The notepad) is marked as it reaches the window
(`spareFromSentence`), and the tool lets its tap be. A sentence runs between two ".", "!" or "?" followed by a space
and a capital, a digit or an opening quote, so "e.g." and "3.5" don't
end one, nor do common abbreviations or initials; it never runs past
its page or more than 800 characters either way. A note's number set
above the line after a sentence's end — an endnote or footnote mark —
belongs to the sentence it ends: the text layer reads "…as he
argued.¹² The next" as "argued.12 The next", with no space after the
".", so the two sentences used to run together (or, with a space, the
next began with the number). The marks are found by their shape
(`noteMarks`: a text node of digits or a note's symbols — `*`, `†`,
`‡`, `§`, `¶`, with commas and dashes between — under 85% of the height
of the text beside it and raised above its middle, measured from the
text's own boxes, not its span's) and, where that can't tell, by their
place: a word's "." (or its closing quote) followed at once by one to
three digits, a space and a capital. Such a mark is taken into the end
of its sentence and left off the start of the next, and a tap on the
mark selects the sentence it ends. ⌘ is read from its
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
the loop is drawn on from there, and the tool stays the pen — though
while the loop is drawn the bar's select tool, and reading mode's pen
button, show the lasso (`lassoBorrowed`, reported as the tool); a pen
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
`UIMenuController`), again 400ms later in case it came up after, and
then every 250ms for as long as the selection lasts: letting go of a
selection handle, or tapping the selection, brings the menu up again
without the page hearing of either. It may show for a moment before it
goes. Selections elsewhere — the notes — keep their menu.

The system's selection handles stay, and they take the touches around
their knobs (above the first line's start, below the last line's end).
So where fingers select (the iPad, or a coarse pointer) the viewer's bar
stands 30px from the passage rather than 8 (`TOUCH_GAP` in
`selectionBar.ts`), and its buttons act on the release of a finger's or
the Pencil's press (`onRelease`) rather than on the click, which the
system's gestures could swallow; the mouse and the keyboard still click.
The bar itself can't be selected, called out or scrolled from.

Why it keeps up with fast writing. One rule covers the pages and the
notepad alike: **what the pen costs must not depend on what is already
there** — not on the ink written so far, nor on the PDF under it. It
comes to three budgets:
- *a sample* (up to 240 a second) draws one curve onto a canvas, reads
  no layout and changes no element;
- *a pen-up* keeps the stroke (plain data) and changes nothing in the
  document, so the next pen-down — a twentieth of a second later, and
  the one place the pen reads a box — finds no layout to do;
- *everything else* (the page's SVG, saves, renders, the store) waits
  for the pen to rest (`lib/penActivity.ts`), and is done at once by
  whatever needs it sooner.

The ways each was broken, and is now kept:
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
  redraw. The canvas is allocated when ink mode starts and
  released when it ends — never mid-stroke, which on iPad drops samples
  (Hush measured it). Coalesced events are used off iOS only, as in
  Hush.
- *Nothing in the page changes while the pen writes.* A finished
  stroke used to join its page's SVG at pen-up. Adding a path makes
  the browser lay the SVG out and paint it again — work that grows
  with the ink on the page (WebKit is reported to paint an SVG's
  elements whether or not they are in view; not measured here) — in
  the gap before the letter's next stroke. Now the stroke stays on
  the live canvas, in the pixels the pen drew (`park` in `layer.ts`
  and `live.ts`), and the strokes of a word or a line join the SVG
  together once the pen has rested 600ms (`SETTLE_REST_MS`, `settle`).
  The canvas lies over the viewer and doesn't move with the pages, so
  they are settled at once by anything that might move the pages or
  needs the drawing: a scroll, a resize of the viewer, a press that
  isn't the pen writing on the same page where it was (a finger, the
  eraser, select, a press on the notepad or a button), the wheel, a
  key, undo, a change of tool, leaving ink mode and the app being put
  away. The bar is written to only when what it shows has changed
  (`sync` in `bar.ts`), not at every pen-up.
- *The text layers are left alone.* `textSelect.ts` put every text
  layer's `.endOfContent` back at every pointer-up anywhere in the
  window, and re-appending it is a change to the layer even when it
  is already in place: each stroke — on the pages or on the notepad —
  left every text layer to be laid out again, and the next pen-down
  paid for it. On a scan with an OCR text layer (thousands of spans a
  page) that was the largest cost of a stroke. Only a layer a
  selection has disturbed is put back.
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
- *The pages wait for the pen — through the gaps between strokes.*
  pdf.js draws and lays out text on the main thread, in slices, and a
  slice that paints a large image (a scan, a photograph) can't be cut
  short: on an image-heavy PDF one is enough to cost a stroke its
  first samples, which on the iPad are lost, not late. Running
  handwriting lifts the pen every twentieth of a second within a
  letter and every few tenths between words, so "the pen is up" is no
  pause: renders used to start in those gaps and be cancelled at the
  next pen-down, to begin again from the first slice in the next gap.
  Now the pen's gestures — ink mode's and the notepad's — report to
  `lib/penActivity.ts`, and what can wait asks how long the pen has
  rested. A page in view with nothing drawn on it yet is drawn once
  the pen has rested 700ms (`PEN_REST_SHOW_MS`, longer than the gap
  between words); everything else — the pages around the view, a
  redraw of a page still showing its old raster, the text and link
  layers of a page drawn meanwhile — once it has rested 1.8s
  (`PEN_REST_MS`, the pause at the end of a thought). A render under
  way when the pen comes down pauses after its current slice and
  carries on from there (`pauseForPen`, through pdf.js's
  `onContinue`, which asks before each next slice) rather than
  beginning again; the folded view's strips wait the same way. A
  relayout (the notepad docking, reading mode) keeps the old,
  stretched raster of the pages in view until the crisp one is drawn
  (the settle pass marks them stale rather than clearing them), so
  the pages written about don't go blank while the pen holds the
  redraw back.
- *Decoded images are let go.* pdf.js keeps a drawn page's decoded
  images and operator list for its next draw. For a page of
  photographs or a scan that is tens of MB, and with two dozen pages
  kept on the iPad a heavy PDF held hundreds of MB besides its rasters
  — memory pressure the iPad answers with stalls. Only the pages in
  view keep theirs (a repaint after a highlight stays quick); a page
  out of view lets go as soon as it is drawn, or as it leaves the view
  (`releaseDecoded` in `render.ts`), and draws again from the PDF's
  data, in the worker, when it comes back.
- *Ink is written at a pause, never between two strokes of a word.*
  The changes of a long stretch of writing without a 2s rest are
  written, once 15s have gone by, at the next gap of at least 250ms
  (`FLUSH_GAP_MS` in `session.ts`) — a gap between words — not at the
  next pen-up, which in running handwriting is a letter's next stroke.

Measured in Chromium (`npm run dev`, the viewer driven with synthetic pen
events): about 0.01ms of script per pen sample, and under 1ms on average
at pen-up (smoothing, merge, SVG). With a 30-page, 9MB PDF of large
images, the CPU slowed 4×, and a sentence written at handwriting pace
(2–5 strokes a letter, ~50ms between a letter's strokes, ~100ms between
letters, ~300ms between words) begun just after turning to a page not
yet drawn — on the pages or on the notepad — holding renders through
the gaps took the frames over 50ms from 11–19 per sentence to 2–4, the
median wait for a pen-down from 29–50ms to 16–37ms, and the longest
from 223–358ms to 54–266ms. With every page already drawn the two were
the same. A sentence of 60 strokes written over a 32-page scan with an
OCR text layer, every page drawn (same set-up): 62 forced layouts
taking 1.4–1.5s before the last two changes above, 1–2 taking 1–3ms
after, and no element changed between the first pen-down and the
pause. Headless Chromium copies every software canvas at each
frame's commit — its own cost, not WebKit's — which dominates what is
left there, so the figures say more about the difference than about an
iPad. Hush's stroke engine (tile-baked
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
order, each with its page and three small buttons — shown on the row
the mouse or trackpad pointer is over, and on the row last picked (a
finger's way to them; on a screen with no hovering pointer at all, on
every row): **Copy** (a
Markdown blockquote with a link back to the page), **Note** (the same
quote, inserted into the entry's notes at the caret — offered when one
entry is selected, since notes belong to an entry) and **Zotero**,
which opens the PDF there on that highlight. Several selected entries, or one with several PDFs, list
under a heading per PDF. When the PDF has an outline (and is open, or
downloaded to this device, where its outline is read from the cached
file), its highlights are filed under the outline's section headings
— the deepest heading at or above each highlight — and headings with
no highlights are left out. The sections the reader adds (Sections,
below) join those headings, or divide the highlights alone in a PDF
with no outline. Post-its, which Zotero keeps as text and ink
annotations, are left out (`isPostItPart` in `highlightGroups`): they
have a tab of their own (Post-its, below).

**The Highlight Map.** With the PDF open and the notes panel wider
than 600px (`MAP_WIDTH` in `MetadataPanel.tsx`), the Highlights tab —
named *Highlight Map* then — lays the same highlights out on a canvas
that pans and zooms (`HighlightMap.tsx`, `src/highlightmap/`). It
replaces the earlier arrangement, in which the wide panel put the
highlights beside the notes under one tab.

*Its shape* (`layout.ts`) is the list's filing, laid out in two
directions. Rows are the PDF's chapters: the outline's top-level
headings, and any heading — the outline's, or a section the reader
added — whose name begins with "Chapter". Columns are what a chapter is
divided into: the outline's headings one level under the chapter's, and
every section the reader added that isn't a chapter. A heading deeper
than that is a small heading inside its column. Walking the headings in
document order, a chapter starts a row, a column heading starts a
column in it, and a highlight goes in the column in force (the nearest
heading above it, as in the list). The highlights before a row's first
column heading are a column with no heading at its start, and those
before the first chapter a row with no heading at the top. As in the
list, the outline's headings with no highlights are left out and the
reader's stay (an empty column says "No highlights"). A PDF with no
outline and no sections is one column; Add Section divides it, and a
section named "Chapter …" starts a row. Several PDFs of one entry are
each a map of their own, under its file name.

*The cards* are the list's rows (`HighlightRow.tsx`) on the panel's
colour, 280px wide, their words cut at ten lines until the card is
picked; a click goes to the highlight in the pages, and Copy, Note and
Zotero show as in the list. Headings: the outline's go to their place in
the PDF, the reader's are the list's `DividerHeading` (go to the line,
Rename, Delete). A column's heading is one line high, and a column
without one leaves the room, so a row's cards start level.

*Moving about* (`view.ts`) is the notepad's way of moving its canvas —
one layer under one transform, set once a frame, over the pad's faint
dot grid, which moves and scales with it — with zoom added. A finger or
the mouse dragged anywhere but on a button or a field pans, and the click
such a press would end in is stopped before it reaches a card (for 400ms,
since WebKit may send a slight drag's click late); a wheel or a
trackpad's two fingers pan. Two fingers pinch; a trackpad's pinch zooms
— WebKit's gesture events on a Mac, a wheel with ctrlKey elsewhere — as
do ⌘ or Ctrl with a wheel (one notch at most ×1.28), each about the point
between the fingers or under the pointer. On the iPad a pinch arrives
both as pointers and as gesture events; the gesture events are then only
kept from zooming the page. The canvas keeps at least 60px of the map in
view. At its lower right: −, the zoom (a press is 100%), + (×1.25 a
press) and the whole map (fitted, never past 100%) — moved in beside the
notepad's pane while it is open. A map seen for the
first time starts at its top left, as wide as fits between 50% and 100%;
after that the view is the PDF's, kept beside it (`hlMap` in
`lib/readerUi.ts`) and put back whenever the map comes back.

*The bar* over the canvas holds the search, the colours, ↻ and, at its
right end, View Notepad (the list's count has no place in it). The search and colours are the
list's own (`HighlightFilters.tsx`, kept per PDF), so the panel crosses
between list and map with the same ones. On the map they work
differently: neither narrows anything — the map keeps its shape, so it
keeps still while they change — and both fade what they leave out to a
fifth: the colours, the cards not in them; the search, the cards that
don't match (or that the colours leave out). The search also goes round
its matches in reading order — to the first a moment (250ms) after the typing
stops, then Enter or › to the next and ⇧Enter or ‹ to the one before,
with "2 of 7" beside the field. Each is glided to (350ms, easing out) and
put in the middle of the view at the zoom in force, unless that is too
small to read (under 45%, when it goes to 100%) or the card wouldn't fit.
Matches are ringed, the one in force in the accent, and their words
marked; the search steps over the cards the colours leave out. A tap on
the bare canvas lets go of the card picked.

*View Notepad* (`MapNotepad.tsx`; an icon with no words — reading mode's
red notepad page with a white arrow pointing left across it, lit while
the pane is open) opens the PDF's notepad as a pane over the canvas's
right, full height — a view of the same pad (see The
notepad), so what is gathered on the map can be written down beside it;
its × or the button again closes it. Its scissors are off there (shown
faded): clipping is for the pages, and the map is what the pane lies
beside. Its quote button links to the map's cards as well as to the
pages: let go over a card (`highlightmap/drop.ts`, which
`readerPlaceAt` in `ReaderPane.tsx` asks before the pages), a link to
that highlight lands on the pad, as over the highlight on its page (a
bookmark's card, a link to its place); the notes' link icon does the
same. It lies over the map rather than beside
it: the map keeps its size, but what it fits, keeps in view and glides
a match to is the part the pane leaves (`covered` in `view.ts`). Its
inner edge sizes it — a strip as thick as the bar that divides the notes
from their notepad (27px with its rule), in that bar's colour — from
240px to all but 60px of the canvas. Whether it is open, and its width, are this
device's (`zh-hlmap-notepad`), whichever PDF is open; it follows the PDF
to begin with, as under the notes.

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
(`isAbout`), newest first (`ItemChats.tsx`), under **Ask About**,
the one way to start one (`AskAbout.tsx`): two tiers of dropdowns, the
first saying what to ask about — Abstract, Full text, Section, Pages
or (with the PDF open) Visible pages, as the Share menu counts them
(see Sharing), kept as the pages come to rest after a scroll
(`useReaderVisiblePages` in `ReaderPane.tsx`, which measures again
150ms after the scroll area's last scroll event, or a resize) — and
the second, beside it, saying which, when that needs saying: a section
of the outline (its headings that point into the pages, each with its
pages, running to where the next heading at its level or above begins
— `sectionSpans` in `lib/outline.ts`), or a first and a last page.
Under them, one link — "Begin conversation with “Methods”" — starts
it. The dropdowns are `PdfParts.tsx`'s, which the reader's Share menu
uses too. The PDF's outline and page count are read at once for a PDF
on this device (the open PDF's come from the viewer) and, for one that
isn't, only once Section or Pages is picked, which downloads it, as
asking would; Section is offered until the outline is known, then only
if it points into the pages. A part
goes to the model as its pages only, after their page markers, under
a line saying which part of the work it is; the chat keeps it
(`ChatSource.pages`, a `PageSpan`), so its lines say "section
“Methods”, pp. 4–9" where a whole paper's say "full text", and a
retrieval after the cost popup reads the same part again. With no PDF
on record, Abstract and Full text are the choices, and the full text
goes to the popup that offers to find one. Conversations it was only part of — a selection
or a folder asked about — are listed above as links, which open in
Questions (leaving the PDF). A conversation's row, here and in Questions, gives
its name and what it is about; when it began, how many questions it
has had, the size of the works it read, its cost and its model are at
the head of the conversation itself (`ChatPanel.tsx`). A conversation
opens in the tab, in place of the
list, so it can be read beside the PDF; one started while a PDF is open
opens there too, rather than moving the hidden library to Questions
(`confirmAsk`).

**The explainer.** The selection bar's sparkles (shown with a service
connected), or a highlight editor's, open a small window about the
selected passage — or the highlight's text — floating
over the pages at the bottom right — reading mode included. It asks
nothing by itself: under its head, a row says what goes with the
question, with **Ask** at its right, and the passage is quoted beneath
it. Ask asks, in the words of Settings → AI → Prompts ("What would the
encyclopedia entry for “…” be?" unless changed), of which the window
shows only the passage (the message's `display`, not shown as a
question: the quote is above) (`lib/ai/explain.ts`,
`ExplainChat.tsx`). There are no follow-ups (though a passage of the
answer can be clarified — see Clarifications). What goes with the
question:
**No Context**, the default: nothing but the question — no page, no
paper — answered under the backend's own system prompt, which explains
the concept on its own terms, as an encyclopedia entry would, in under
100 words (`ai_chat`'s `mode` "explain", `src-tauri/src/ai/chat.rs`);
so there is no cost popup first. **In Context** opens a small menu of
what goes with it (`ExplainContextMenu.tsx`): **Full text** (the whole
PDF up to 80 pages, else the 80 pages around the passage), **This
section** (the section of the PDF's outline the passage is in, from its
heading to the next at its level or above — `sectionSpans`, as Ask
About's; unavailable without an outline, or before its first heading)
or **Visible pages** (the pages in view, as Ask About and Share count
them). Each says what it covers, and the work's metadata — its title,
authors, year and publication — goes with every one; the text of the
part is read with the same local parser as Ask Full Papers, page
markers and all, capped at 120,000 characters (`explainContext`), and
a part says it is one. The answer is about what the passage means in
this work, in under 120 words ("explain-context"). The passage's page
goes with the question ("The passage is on page 12 of the PDF", added
as it is sent, `askModel`), not in the context, so that every passage
of a PDF asked about with the same part sends the same context, which
the provider then serves from its prompt cache: a part sent within the
cache's window (5 minutes on Anthropic, 30 on OpenAI, from its last
use) — for this passage or another of the same PDF — says so in the
menu, "Already sent — cached for 4:12 more" (`lib/ai/contextCache.ts`,
kept on this device; counted only when the reply reports the cache
written or read, or, on OpenAI, which caches by itself, a prompt of
1024 tokens or more). Choosing — No Context, or a part from the menu
(the one chosen is ticked) — asks nothing; once there is an answer, a
different choice turns the button to **Ask again**, which asks, the new
answer in place of the old (the cost of both is kept), its
clarifications going with the old one. Should that fail, the old
answer, its context and its clarifications are put back. The window's
foot shows the part asked with, the context's size and what the
explanation has cost. An explanation whose window closes before
anything was asked — nothing in it, nothing spent — is let go of, its
underline with it (watched from the store in `explain.ts`, so closing,
opening another and closing the PDF all count). The head, the switch and the foot keep their
height however long the passage; what is between them scrolls. ×,
Escape or a press outside it closes the window (Escape and a press
outside close the menu first). Each is kept as a conversation about the entry (`mode`
"explain", one question and its answer), named after its passage —
but shown as what it is: under Explanations in the entry's
conversations tab, and in **Explanations**, a row between Questions and
Words in the sidebar, never among Questions' conversations
(`ExplanationList.tsx`). Each is a box: the passage as its head, in
the text's own weight, a link that unfolds the answer beneath it, set
in as far as the passage (folded to begin with, and drawn as a box,
background and edge, only while unfolded). A passage of more than six
words is headed instead by a short title the model gives it
(`Chat.heading`, asked of `ai_chat_title` with the passage and the
answer, as a conversation is named — once the answer is in, and, for
one from before, as its box first shows: `headExplanation`, one at a
time, its cost added to the explanation's), its first six words until
it has one; unfolded, the box shows the passage whole, quoted, above
the answer. The explainer's head takes the title too; at its right, the page the
passage was read on ("p. 12"), the link back to it — the PDF opened (or
moved) there and the passage found and marked, as an answer's
citations are — then an info button that shows when it was asked, by
which model, what it cost, with which part of the work as context, if
any, and from which work, and a quieter trash can; the sidebar's list, every document's
explanations newest first, adds under each the work, a link back too,
and a filter
box at its top that narrows the list by passage, title, answer or
work. The
explained passage stays marked in the PDF with a dashed purple
underline (`--explain-underline`, an overlay like a citation's,
`passageMarks.ts`; where it is kept as the chat's `passage`), and a tap
on it opens its explainer again — in reading mode too. One asked from a
highlight's editor isn't underlined (the highlight marks the passage,
and keeps its tap, which opens the editor); it is kept with the
highlight's key (`passage.annotationKey`), and the editor's Explain
opens it again while the highlight's text is unchanged, rather than
asking anew. The window is made afresh for each explanation
(`ExplainChat` keys its `ExplainWindow` by the chat), so nothing of one
— the question last asked again, an error, the menu, the columns open —
reaches the next. The window's
foot has **Remove Underline** (a second press confirms): the
explanation is kept, and its page (the In Context menu and the list's
link back go by it), but the passage's rects are let go, so the
underline and its tap are gone from the PDF. The way back from the
list is kept all the same: it finds the passage by its words and marks
it for the moment, as an answer's citation does (`citeMark.ts`).

**Look up and Words.** The selection bar's magnifier (and the
highlight editor's) asks for a definition of the selected word or
phrase — "Define “…”" unless changed in Prompts, with no context at all,
so the answer is its meaning and nothing about the work — under a
system prompt that keeps it to at most 50 words (`mode` "define"). The
answer shows in a small box over the bar (`lookupPopup.ts`), a one-off
that goes with the selection and is never part of a conversation
(`lib/ai/lookup.ts`). A word looked up from a selection stays
underlined in the pages — dashed, in pink (`--explain-mark`) — and
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

**Clarifications.** In a Questions conversation or an explainer, a
passage of an answer can be selected and asked about. The selection,
once it comes to rest (a pointer let go; on the iPad, a pause while the
handles move), brings up a small bar under it (`ClarifyPopover.tsx`):
the passage, quoted, then **Clarify** — which asks in the words of
Settings → AI → Prompts ("Clarify this part of your last answer: “…”"
unless changed) — and a box to ask a question of one's own about it
instead. The bar is placed on the screen, under the passage (over
it where there is no room below), and goes with a scroll unless it is
being typed in. Either way the answer opens in a new column to the
right of the one it was asked in, headed by a back arrow and the
passage again, quoted (`ThreadStrip.tsx`). Each column starts at the
top and scrolls by itself, and the strip scrolls sideways between them,
settling on a column's edge: each column is the strip's width where
the strip is narrow (the details panel, as usual), half of it where two
fit (640px and up), and the explainer's window widens to show two while
one is open. A new column is scrolled into view; its back arrow closes
it, bringing back the column it was asked in. A clarification isn't
deleted by itself: it goes with its conversation or explanation (or,
for an explanation, when it is asked again). Every passage asked about stays marked
in its answer, tinted (`--thread-mark`); the one whose column is open
more strongly, with an amber edge under it. A tap on a passage opens
its column, or closes it if open. One column is open to the right of
each, so the columns open are a path — the conversation, a
clarification of it, a clarification of that, as deep as one likes —
and opening another from a column closes those right of it. In a
Questions conversation a clarification has a box at its foot to carry
it on, as the conversation itself is carried on from the one below; an
explainer's clarifications can be asked about, not carried on.

What the model is sent is an ordinary next turn: the conversation as it
stood when the answer was given — its messages up to that answer, and
for a clarification of a clarification, each one on the way down up to
the answer the next was asked of — then the question, over the same
works and under the same system prompt (`askModel` in
`lib/ai/chat.ts`), so the works come from the provider's cache as any
later turn's do, and an answer's citations are pills like any other.
Each clarification is kept with its conversation (`Chat.threads`: the
thread it was asked in, the answer, the passage and its exchange, in
`chats.json`), and what it cost goes into the conversation's total.
A clarification's request runs apart from the conversation's
(`useThreadBusy` in `lib/ai/threads.ts`), and every reply — the
conversation's own too — goes into the chat as it is when the reply
comes, so asking about one passage while another is answered loses
neither. One that fails keeps its question, unanswered, with **Try
again**. Asking an explainer again with the other context lets go of
its clarifications, with the answer they were asked of. Share
Conversation adds them after the exchange, under **Clarifications**.

Where a passage is: offsets into its answer's rendered text, counting
every character but white space and the words of citation pills
(`lib/ai/threadMarks.ts`). A selection is measured in the page; the
marks are made in the Markdown pipeline (a rehype plugin, as
`<mark>` elements React renders) — and the two trees differ in white
space (the renderer drops it between a table's rows) and in the pills
(the tree being marked has the citation's link where the page draws
"p. 12"), so neither is counted on either side. The marks reflow with
the text, and a tap on one is an ordinary click.

**Prompts.** Settings → AI → Prompts holds the explainer's, the
look-up's and a clarification's questions as templates — text with tokens in it, shown as
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
(`src/pdfviewer/bookmarks.ts`; the box is `nameBox.ts`, shared with
Sections). On a page that already has one, the
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

### Sections

The Highlights tab files highlights under the PDF's outline, which many
PDFs lack or get wrong; **Add Section** lets the reader divide a PDF
themselves. The button sits after the sentence tool and Post-it in the
bottom bar (a page with a dashed line across it), first below the ×
among reading mode's buttons, and on A. Pressed, it readies the tool: the pages take
a crosshair, and a faint dashed guide follows a mouse or a hovering
Pencil across the page under it. The next tap on a page draws a
section's line across it there and opens the naming box under its
label (the bookmarks' box, `nameBox.ts`), filled with the line of text
just below — usually the heading the section begins at — and selected,
so typing replaces it ("Section" when there is no text there). Add, or
Enter, keeps it; Escape or a press elsewhere drops it. Either way the
tool is done: it draws one line per press of the button, and a second
press, or Escape, puts it away unused. While ready it has every press on
the pages to itself — heard on the window before anything in them (the
sentence tool, highlights, ink, the Pencil's own handling), the click
that ends the tap too — so the tap selects nothing and draws nothing; a
finger's drag still scrolls, and only a tap draws. It leaves the folded
view, which shows strips of pages.

On the page, a section is a dashed line across it in the accent colour,
its name on a tab at the left, sitting on the line (a little
see-through, since it may cover the end of a line of text, until it is
pointed at). The tab is the section's handle: a tap opens the box to
rename it or Remove it, a drag moves the line up or down its page (a
finger's drag too — the tab takes no scrolling). The lines are an
overlay on each page in percentages of the page, like the explained
passages', so they follow every zoom and need no raster; under a
reading crop the tab moves in to what is shown, and while the crop is
adjusted they are hidden (`src/pdfviewer/dividers.ts`,
`pdfviewer-sections.css`).

In the Highlights tab the sections join the outline's headings in
document order (`withDividers` in `src/lib/dividers.ts`): a highlight
files under the nearest heading above it, the PDF's or the reader's,
and a section sits a level under the outline heading it falls in (at
the top level with no outline). A section's heading is drawn over a
dashed rule in the accent, as its line is; a click goes to the line —
in the open PDF, or opening it at the page — and Rename and Delete (a
second press confirms) show as a row's actions do
(`DividerHeading.tsx`). Unlike the outline's headings, a section with
no highlights under it still shows, unless the search or a colour
narrows the list. On the Highlight Map a section is a column of
its chapter's row — or, named "Chapter …", a row of its own (see
Highlights). They are kept like the bookmarks: `sections.json` in
the app's data folder (`src-tauri/src/dividers.rs`, opaque JSON; the
shape is `Divider` in `src/lib/dividers.ts`), on this device only, never
sent to Zotero. (In the code they are dividers, to keep them apart from
the outline's sections.) Not yet done: sections among the outline
panel's headings, and the Share and Ask PDF menus' choice of a section.

### Post-its

**Post-it** sticks a square of coloured paper on a page, to write on
with the Pencil or type on — a little notepad that stays where it was
put. The button is in the bottom bar between the sentence tool and Add
Section (a square of paper, its corner turned up), among reading mode's
buttons below the pen, and on T. Pressed, it readies the tool as Add
Section does: the pages take a crosshair, a dashed square of the paper
(in the colour it will be) follows a mouse or a hovering Pencil over the
page under it, and the next tap on a page sticks a post-it there,
centred on the tap and kept inside the page. One post-it per press; a
second press, or Escape, puts the tool away unused. While ready it has
every press on the pages to itself, heard on the window before anything
in them; a finger's drag still scrolls (`src/pdfviewer/postits.ts`).

A new post-it is 113 × 113 points — 113 × 113 CSS px at 100% zoom
(`POSTIT_SIZE`; its type, margins, grip and pen are set apart from it,
so a smaller paper holds fewer words, not smaller ones) — and, like the
paper it stands for, belongs to its page. Each keeps the size it was
made at (its rect is stored), so post-its made at an earlier size stay
that size. It is an
overlay on its page wrapper placed in percentages of the page, as the
sections' lines are, so it grows and shrinks with the page through
every zoom, fit and reading crop, with no raster. Its type (11pt, lines
1.3 apart) and its writing scale with it: each post-it's `--pk`, CSS px
per point, is set as its box changes (a ResizeObserver). Its colour is
one of five — yellow, pink, blue, green and orange — the one picked last
on this device to begin with (`zh-postit-color`). The paper keeps its
colours and black ink in the dark theme; dark pages only dim it a
little (`postits.css`).

The paper is 70% opaque, so the page shows faintly through it, and 90%
while it is worked on — typed or written on, dragged, its menu open —
fading back once that ends (writing counts until it settles, 600ms
after the pen rests): the paper is a `::before` of its own under
everything on it, its opacity eased between the two. The painted
copies (thumbnails, folds, clips, the library's first-page thumbnails)
are 70% too; the Post-its tab's cards are opaque.

Across its top is its grip, a band a shade darker, 9 points deep: a
drag there (any pointer; a finger there doesn't scroll) moves the
post-it about its page — not onto another — and a tap opens its menu
above it (`postitEdit.ts`): the
five colours, **Type** and **Delete** (a second press confirms). On the
paper the Pencil writes, and so does a mouse dragged (a click alone
writes nothing); two taps of a finger, or a double-click, type on it.
A finger otherwise scrolls the pages as anywhere else. Where fingers
point, the grip reaches 12px below its band (`--grip-reach`), which a
finger couldn't otherwise hit; the Pencil and the mouse still write
there, the grip taking only their presses on the band itself. Typing is a bare
textarea over the paper below the grip, in the paper's own face and
size, the words raw; Escape or ⌘↩ ends it, and so do a press anywhere
else, the focus leaving it and the app being put away — the words kept
each time. An empty post-it says "Write here, or double-tap to type".

**Paring one down.** So that a post-it can stay where it is without
covering the text, its four corners crop it at rest (`postitCrop.ts`):
dragged (any pointer; a finger there doesn't scroll), a corner brings
in the two edges it joins — the grip moving down with the top edge —
leaving at least 24 points each way, with the whole paper's outline
dashed round the part kept while the corner moves. Only what shows
changes: the paper, its words and its writing stay whole. What is pared
away is not there at rest: presses on it reach the page beneath. The
corners are an L at each corner of what shows, in a target centred on
the corner — half outside the post-it, so a narrow one keeps most of
its grip (the top two lie over the grip's ends and are pressed before
it) — on a hovering mouse's post-it and always where fingers point; not
while it is open, nor on someone else's. Its menu offers **Whole**
while it is pared down (which also brings it back to its open place).

**Two places.** A pared-down post-it is closed at rest and opens to be
worked on. Closed, it is at its rest place, which its grip drags about
the page as far as the part that shows stays on it — so a sliver can be
parked against the page's edge, the rest of the paper past it
(`postitMove.ts`). A press on it — a finger's tap, the Pencil's or the
mouse's press, which writes nothing — or Type opens it: the whole paper,
at its open place, always inside the page, the crop and the slide
easing out (0.2s); there it is typed and written on as any post-it, and
its grip moves the open place. A press anywhere else, or Escape, closes
it, sliding it back to its rest place and its crop. The open place is
the rest place moved into the page by the least it takes (the two are
the same unless the paper would reach past the page), and it is what
Zotero has: the record's `rect`, so Zotero shows the words and the
writing whole and on the page; the rest place is `shift`, its distance
from the rect in points (x right, y down), and the crop `crop`, four
insets in points (left, right, bottom, top; three, without the top,
from before it could be cropped) — all in `zhPostIt`, so they come back
on other devices. A post-it never pared down has no closed state, and
is worked on where it is.

Built so: the element keeps the whole paper's box at its open place
(so the writing, the editor and `--pk` are as before), moved to its
rest place by a `transform` while closed, and takes no presses itself;
the paper is its `::before`, placed by the crop, and everything on the
paper is in a sheet clipped to it (`clip-path: inset()`), so only the
part kept shows or is hit. `.open` (and typing or writing) zeroes the
crop and the transform. The thumbnails, folds, clips and the library's
thumbnails paint it closed — at its rest place, pared down — and the
folded view folds round what shows; the Post-its tab shows it whole.

Writing on one follows the pages' ink (`postitInk.ts`): the kept strokes
are an `<svg>` in the paper's own points, stretched with it; the stroke
under the pen is drawn on a canvas over the paper, a segment a sample,
with nothing read from the layout after the box at pen-down; at pen-up
the stroke is smoothed as Zotero smooths ink (`smoothPath`) and kept,
staying on the canvas until the pen has rested 600ms, when the strokes
of a word join the SVG together. The canvas is in the paper and moves
with the page, so a scroll needs no settling. The eraser — the one ink
mode and the notepad share (`lib/penTool.ts`, the Pencil's double-tap,
which now listens while a post-it is on the pages too), or a pen's
eraser end — takes out every stroke it passes over. The writing is one
pen, black, 1.4pt. Every gesture reports to `lib/penActivity.ts`, so
page renders and the push wait for the pen as they do for ink mode.

A post-it's presses are its own: one listener on the scroll area,
registered before ink mode's and the rest and stopping them there
(`stopImmediatePropagation`), so the Pencil on a post-it never draws on
the page beneath — ink mode on or off — and a tap on one never selects a
sentence or opens a highlight. A finger's press goes on to scroll
natively: only the Pencil's touches are cancelled, by a non-passive
listener on the post-its' own layer, so scrolling elsewhere stays on the
fast path. The click that ends such a press is the post-it's too. While
Add Section is ready, or the reading crop is being adjusted, a press on
a post-it is theirs.

**In Zotero.** Zotero has no post-its, so each is kept as the
annotations of Zotero's own that come nearest (`src/lib/postits.ts`):
its words as a **text** annotation — Zotero's text box, the words in its
comment, `fontSize` 11, its rect the paper's inside its margins and
below its grip, in black — and its writing as **ink** annotations, the
strokes as paths in PDF points at 1.4pt, in black; one ink annotation,
or more should the writing outgrow one's position (65,535 characters).
So Zotero desktop, iOS and the web library show the words and the
writing where they are on the page (without the paper). Each part
carries, in its position beside what Zotero reads, the post-it's own
record, `zhPostIt`: its id (tying its parts together), its paper's
colour, its rect (where it is open) and, when it is pared down, its
crop and its rest place (above). Zotero's server keeps a position as it is given,
and its reader keeps unknown keys when a text box is resized; moving one
there writes a new position without them, and the part becomes an
ordinary text box or drawing again — drawn as such here too.

A post-it always has at least one part: its text annotation while it
has words, or while it has no writing either (an empty post-it is an
empty text box, so that it is kept); its ink while it has writing.
`savePostIt` brings the parts in line with what the post-it holds —
creating, updating and deleting as needed — through
`lib/annotationEdits.ts` (which now makes text annotations too), so the
same outbox and push as the highlights, offline included; Delete
deletes every part. A post-it someone else made in a group library is
shown, not changed. Writing is written once the pen has rested 2s (past
the pause between words); a move, a colour, the words typed, at once.
Until then — and while it is being written on, typed on or dragged — a
post-it is the layer's own, and the copy that comes back through the
store doesn't overwrite it. Post-its are read back out of the library's
annotations wherever they show (`postItsOf`), so they come back on
another device with the next sync.

**Elsewhere.** The pages' own rasters leave post-its out (they are the
overlay), but the thumbnail grid, the folded view's strips and the
notepad's clips paint them in, as they look on the page
(`postitPaint.ts`, through `drawAnnotations` in `paint.ts`), as do the
library's first-page thumbnails (their paper and writing). The folded
view folds round the whole of a post-it, and its filter lists post-its
as **Post-its** by paper colour (`comboKey` in `foldSpecs.ts`), counted
once each whatever their parts. Ink mode leaves their ink alone (it
neither draws nor erases nor selects it), and the Highlights tab and the
Highlight Map leave them out.

**The Post-its tab** (`PostItsPanel.tsx`), beside Highlights when the
selection has any post-its (⇧T): each as it looks on its page, smaller —
the paper, its words and its writing, all at one scale (0.9px a point),
so a smaller post-it is a smaller card — in reading order, with its page
under it; several PDFs list under a heading each. With the PDF open a
click goes to the post-it on its page; otherwise it opens the PDF there.

Not yet done: undo for a post-it's writing, making a post-it larger, moving one
to another page, the Pencil's colours on one, and pages with a /Rotate
(where a post-it's writing would be drawn turned).

### The notepad

A scratchpad for the Apple Pencil, one per PDF, to be typed up into the
notes afterwards (`src/notepad/`, `NotepadBody.tsx`). It shows in three
places, sharing one pad (`notepadFor` / `watchNotepad` in
`model.ts`, so a change in one view redraws the others): floating over
the pages in reading mode, in the notes pane's lower half, and over the
Highlight Map's right (View Notepad in its bar; see Highlights).

**In reading mode** (`ReadingNotepad.tsx`) the closed pad is an icon, a
filled red rectangle, at home in the next place down reading mode's
buttons at the left (below the pen, `homeSpot`), which a drag moves
anywhere. While it is dragged, its home shows as a dashed ring (filled
once the icon is within 40px), and let go there the icon settles home
again (kept on this device, `zh-notepad-icon-2` and
`zh-notepad-icon-home`). A tap opens the pad
out of it: the pad grows from the icon's box to its own (`morph`, the
Web Animations API, 260ms), and closing shrinks it back into the icon;
while the pad is open the icon is hidden. The two keep their places
apart: the pad opens where it was last left, whatever the icon's
place, and closing it leaves the icon where it was put. Four-fifths of
the window's height
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
the left one filled, an arrow from its middle to the right one's, on or
off (`zh-notepad-autoshift`). On, a press on the pages on
the pad's half of the window — the Pencil's or a finger's; not on the
pad itself — slides the pad to the same place on the other half
(`left` mirrored, a 0.3s slide), so it keeps to the page not being
worked on. A docked pad changes edges instead, once the press is over,
since the pages are laid out again. That press is the pad's alone: with
the sentence tool on, its tap doesn't also select a sentence
(`spareFromSentence` in `sentenceMark.ts`) — the next tap does.

**Under the notes**, from **View Notepad** at the pane's foot
(`NotesPanel.tsx`) — the bar between the notes and the pad is the
divider, dragged to share the height, with Hide Notepad at its middle.
At the bar's right, two switches, lit while on: **full height** (bars
at top and foot, an arrow between) gives the pad the whole pane, the
bar at its top and the notes out of sight but still open (their caret
and undo kept); **full screen** (arrows to two corners) puts the bar
and the pad over the whole window (z-index 70, under the modals; below
the iPad's status bar while there is one). Pressed again, each goes back
to the split; full height pressed in full screen leaves it for the pane's
height, and Hide Notepad leaves full screen too. The pad is one element
through all three — only its place changes, by CSS — so its undo and pan
carry on (`notepad-notes.css`). The split and full height are kept on
this device (`zh-notes-notepad`); full screen lasts while the entry's
notes are open.

Either way it is one continuous surface in the panel's colour: a slim
bar of tools over the canvas — a very faint dot grid, which pans with
it. From the bar's left: the quote button, the scissors (clip mode),
the host's own tools (auto-shift), the map, the scroll link (following
the PDF), the empty middle; then, just before
undo and the host's close, one switch of four parts saying what the
Pencil does: write in the ink of the theme — black, white in the dark
theme (`--notepad-ink`; such a stroke is kept with no colour, so it
follows the appearance) — write in red, the reading-mode red
(`RED_INK`, `#ff5f57`, kept with the stroke), erase, or lasso. The
colour is this device's (`zh-notepad-pen-color`), shared by every view.
With strokes selected (the lasso), a colour picked recolours them too,
and the tool stays as it was (`setColor` in `surface.ts`; undone like
anything else).

The quote button and the scissors share one pill of the highlight
orange (`#f19837`), split down the middle — round at its ends, square
where the halves meet, a hairline of the pad's colour between them —
their glyphs in the pad's own colour: the two ways of bringing
something in from the pages. A half is darker while its tool is at
work: a link being drawn out of the quote, or clip mode on.

On the canvas the Pencil writes — a tap is a dot — a finger pans, and a
mouse writes with a drag (a Mac has no Pencil) while a wheel pans; each
view pans on its own. Two taps of a finger, or a double-click, on the
bare canvas begin a typed note (**Text notes**, below). The ink is one canvas the size of the view
(`ink.ts`), under a layer that pans with it and holds the notes'
labels, the links' chips and the lasso; there is no React render under
the pen (`surface.ts`). A sample draws one curve from the last sample
onto the canvas, and at pen-up the stroke is already where it stays;
the canvas's box is read once, as a press begins. The pad is drawn
from its strokes only when the view changes — a pan (once a frame), a
resize, an erasure, a move, another theme — and then only the strokes
in view, each one's box and line kept with its points. So the pen
costs the same on a full pad as on an empty one. It used not to: the
ink was one `<svg>` with a `<path>` per stroke, the stroke under the
pen grown by setting its whole `d` again at each sample, and every
sample had the SVG laid out again (a walk over every stroke, forced
at once by the next sample's read of the canvas's box) and painted
again — which is why the pad slowed to a crawl after a few pages of
notes. The same sentence written at the foot of a pad of 0, 500, 2,000
and 6,000 strokes (Chromium, CPU slowed 4×) took 2.8, 4.2, 5.7 and
10.5s of the main thread, with 988 forced layouts; now 1.7–1.9s
whatever the pad holds, with 2. The canvas is sized when the view is,
never while the pen writes. What a stroke sets off waits for the pen, as the pages' ink does (see
"The pages wait for the pen"): the pad's gestures report to
`lib/penActivity.ts`, so the PDF's renders hold off while it writes
(they used not to: the pad over an image-heavy PDF had every page
render land between its strokes); a finished stroke moves only its own
note's label (from the note's corner, kept as its strokes arrive),
where it used to rebuild every label and every link's chip; and the save (the whole pad as JSON, over IPC), the minimap's
redraw and the other view's (the notes pane's pad, hidden in reading
mode, which redraws in full) wait for a 1.8s pause. Putting the app away
saves at once.
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
inside it and the links whose middle is (not those fixed by a pin). The selection is framed, with
Delete above the frame; a drag that starts inside the frame moves it
(any pointer), ⌫ deletes it, Escape lets go, and so does a tap on it
or a press anywhere else — the Pencil then writes at once. Anywhere
else means the window, not just the canvas (`away` in `lasso.ts`): the
pages, reading mode's buttons, a link's chip not in the selection. The
pad's own bar keeps the selection, since its colours recolour it, and a
press on a chip that is in the selection moves the whole selection.
Held, the
lasso is borrowed for the one press; the switch's fourth part makes it
the tool, when every press of the Pencil or the mouse draws one at
once. While a held press's loop is being drawn the switch shows the
lasso — the only sign, before the Pencil moves, that it has become one
— and goes back to the tool in force when it lifts (`lassoBorrowed`).
Strokes or links selected and then gone some other way — erased,
undone, cleared, changed in another view — leave the selection too
(`prune`, after every change), and with nothing left the frame and its
Delete go. The frame and its Delete show only while something is
selected: a drag whose selection was let go of on the way (Escape,
undo, a redraw from the other view) used to put the frame back where it
had been as the drag ended, with a Delete that had nothing left to
delete.

Strokes written while the reader stays on one page are one note;
turning to another page — even to come straight back — starts the next
(each view counts the visits to the page in view, `NotepadBody.tsx`).
A note remembers where in the PDF the reader was when it began — the
page at the view's centre and the height a quarter of the way down the
view (`placeInView` in `pdfviewer/places.ts`) — and shows that page,
small, above it; a finger tap (or a click) on a note goes back there.
The scroll link (an arrow pointing up and down, two bars across its
middle) makes the pad
follow the PDF: as the reader turns pages it glides (350ms, easing out;
a press on the pad stops it) to the part of the
pad about the page in view — the top of its notes and links, or for a
page with none, between those of the pages before and after it as far
along as the page is, or just under the last (`spotFor` in
`follow.ts`) — supposing the pad is written top to bottom as the PDF
is read. It starts off in the floating pad and on under the notes, and
each view remembers its own.

The quote button makes a link (`links.ts`): pressed and dragged out onto
the pages, a dashed line running from it to the pointer, and let go
over a highlight or a spot on a page (`placeAtPoint`) — or a card of
the Highlight Map (see Highlights) — it puts a link on
the pad — a link icon and "p. 12", or the whole of the highlight's text
beside a bar in its colour, its page after it at half opacity — to be
dragged where it belongs and tapped to go back there. A highlight's
quote is sized by a small dotted circle at its lower right (the
floating pad's grip, smaller): its width and height are kept with the
link (`w`, `h`), the text wrapping to the width and clipped at the
height. A link held (a long press, or a right-click) opens a small menu
under it with Delete.

**Pins.** A quote has a pin under its link icon, at its lower left (a
clip has one under its image, before its page). Pressed, it fixes the
quote to the pad (`fixed` on the link): it moves to a layer that pans
with the others but lies beneath the ink (surface.ts's `under`), so the
Pencil writes over it, and it is flat, not dragged, sized, selected by
the lasso or held for its menu — only its pin, now filled orange, takes
a press, to let it go again. A tap on it otherwise is the canvas's,
which goes to its target as a tap on a note goes to the note's place.
Undo takes back a pin as it does a move.

**Clips.** The scissors (off in the pane over the Highlight Map) turn
on clip mode (`notepad/clip.ts`): a
transparent overlay is laid over the pages' scroll area, inside the
viewer (as the thumbnail grid is), so every press — a finger, the
Pencil, the mouse — goes to it rather than to the pages' many handlers
(selection, ink, the sentence tool, highlights); a wheel or trackpad
still scrolls the pages beneath, though a finger doesn't. A drag on a
page draws a box, dashed red, the rest of the view dimmed a little,
with **Clip** under it and × beside that; a press inside the box moves
it, one on a corner sizes it, one anywhere else on a page starts
another. The box is kept as fractions of its page and follows it as it
scrolls. Clip draws the region afresh from the PDF (`clipImage` in
`pdfviewer/excerpt.ts`: up to 3 pixels a point, at most 1800 on the
longer side, the reader's highlights and ink painted in, a JPEG) and
puts it on the pad as a link with an `image` — at the middle of the
view, as wide as the region in points (at most 70% of the pad), its
target the spot on the page it came from — and clip mode ends; so do
Escape, × and the scissors again. On the pad a clip is the image with
its pin and page under it; it is dragged, tapped (to go back to its
place), held for Delete and sized by its grip like a quote, keeping
its proportions.

A clip is made twice: as printed, and white on black, as dark pages
draw it (`darkPagesCopy` in `pdfviewer/darkPages.ts`: the same
`invert(1) hue-rotate(180deg)` drawn into a copy of the canvas through
the context's `filter`, or pixel by pixel where a canvas has none — the
two agree to within 1/255). The link keeps both (`image`,
`imageDark`), and both are in the chip; CSS shows white on black only
for a clip pinned in the dark theme, where the ink written over it is
white, and the printed one otherwise — loose in either theme, pinned in
the light one (`notepad-clips.css`, reading the theme as `tokens.css`
does, so a change of theme needs no redraw). A clip made before there
were two is given the filter in CSS instead. The images are kept in the
notepad's file, so a pad of many clips is a larger file to write. The menus' buttons act on the release of a press
(`onPress`): the canvas cancels its touches so a finger pans, and that
cancelled the click a tap on them would have ended in — Delete did
nothing on the iPad.

**Text notes** (`notepad/texts.ts`, `markdown.ts`,
`notepad-texts.css`). A double-tap with a finger, or a double-click, on
the bare canvas — two taps within 400ms and 24px, not on a note or a
pinned link — opens an editor there; the Pencil's taps stay dots. What
is typed is a note in Markdown, set as Hush sets a notebook's text
shapes (its `markdown.ts`, ported): no box round the words, 16px type
(scaled by the UI font size) with lines 1.3 apart, as wide as its words
up to 350px; `#`, `##`, `###` headings at 1.8, 1.4 and 1.15 times the
size in the accent colour (Hush's heading colour), not bold; `**bold**`,
`*italic*` or `_italic_`, `[links](url)` underlined in the accent,
`==highlights==` in yellow; a `> ` quote in italic at 80%, a rule down
its left; `- [ ]` / `- [x]` tasks with a box; `-`, `*`, `+` and `1.`
lists hanging from their markers, a level for every two spaces. Each
line stands on its own, as in Hush — a blank line is a blank line —
and Hush's wikilinks, flags and YOUAREHERE, which have nothing to
point at here, are left out. Runs are set as text, never as HTML. The
editor is a bare textarea at the note's place, the Markdown raw in the
same face and size, with a blinking bar while it is empty and Hush's
⌘B, ⌘I, ⌘= and ⌘K (bold, italic, a highlight, a link). Escape or ⌘↩
ends it, and so do a press anywhere else on the pad (heard before the
canvas or a chip has it), the focus leaving it (150ms on, as in Hush),
the view closing, undo, clearing, and the app being put away (which
writes the pad at once) — the words kept each time. A new note left
empty is dropped; a note emptied is deleted. One begun nearer the
view's right edge than 350px wraps to the room there (120px at
least), so it starts out in view.

A text note is a link (`text` on it, `model.ts`) whose target is where
in the PDF the reader was when it was begun, so it is all that a link
is: dragged, held (or right-clicked) for its menu — Edit, then Delete —
selected and moved by the lasso, undone, a grey bar on the minimap, and
found by the scroll link. Its page is shown small above it, as a
handwritten note's is, and a tap on it goes there once the double-tap
window is out; a second tap within it opens the note's editor. A tap
on a task's box ticks it, and on a link opens it — Zotero's link to a
place in the PDF open in the reader goes there, other web, mail and
Zotero links go to the system (`openLink` in `NotepadBody.tsx`). Its
grip, fainter than a quote's, sets the width it wraps at (`w`). A
change to its words draws its chip alone again (`redrawChip` in
`surface.ts`): the press that ends the editing may be on another chip,
and a full redraw would have pulled that chip out from under it. The
canvas is `overflow: clip` where WebKit knows it, and any scroll of it
or of a box round it within the pad is put back at once: WebKit
scrolls a box to follow a caret even when its overflow is hidden,
which left Hush's canvas shifted in its pane with no way back.

The map icon shows a minimap, a 60px column down the canvas's left
(`minimap.ts`; off to begin with, remembered for each view): the whole
pad small — strokes, and links as bars in their colours — with the part
in view outlined; a tap or a drag on it brings that part into view,
going no further than half a view past what it draws. It fits the pad's
contents and the view together; its strokes are on a small canvas of
their own (the links and the outline are SVG over it), so a pan within
the contents moves only the outline, and the strokes are drawn again
only when the pad changes (the surface's `watch`, at a pause in the
writing) or the fit does. A faint trash can at
the canvas's lower left clears the pad — strokes, notes and links —
once "Clear the whole notepad?" is answered. Undo takes back the last
stroke, erasing, link or clip, text note or change to one's words,
move, pin, recolouring, deletion or clearing (`history.ts`); a note
being typed is ended first, so undo takes that back. Kept on this device
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
| PDF viewer | Fit one / two / three / four / five pages | 1 / 2 / 3 / 4 / 5 |
| PDF viewer | Paged / continuous view | P / C |
| PDF viewer | Draw (ink mode) on / off | I |
| PDF viewer | Sentence tool (a tap selects a sentence) on / off | S |
| PDF viewer | Add Section (the next tap on a page draws a section's line) | A |
| PDF viewer | Post-it (the next tap on a page sticks a post-it there) | T |
| PDF viewer | Show post-its | ⇧T |
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

- After moving or copying the checkout, a build can fail with `failed to
  read plugin permissions` and a missing `.toml` file under the **old**
  checkout's `src-tauri/target` directory. Tauri's generated permission
  metadata contains absolute paths that can survive in Cargo's build cache.
  From the current checkout root, run:

  ```sh
  npm run ios:clean
  npm run ios:build
  ```

  Stop any running builds first. `ios:clean` runs Cargo's full clean so both
  host build-script outputs and iOS target artifacts are regenerated. It
  removes compiled artifacts for all targets in the configured Cargo target
  directory; the next build recompiles dependencies. It preserves source,
  lockfiles, and `src-tauri/gen/apple`, including Xcode signing settings.
  Disabling Xcode script sandboxing does not repair stale paths. If the
  error still names the old checkout after cleaning, check `CARGO_TARGET_DIR`,
  Cargo configuration, and the Xcode project's Build Rust Code phase for
  references to that location.

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
- The Continue Reading widget is an app extension added to the generated
  project by `npm run ios:widget` (see Continue Reading, above), which
  the build scripts run when it is missing; it needs XcodeGen (as
  `tauri ios init` does) and the App Groups capability for the signing
  team. If a build reports the app group missing from a provisioning
  profile, open the project in Xcode once and let it register the group
  (Signing & Capabilities, both targets).
- Trackpad scrolling (Magic Keyboard) needs two keys in
  `src-tauri/Info.ios.plist`, as in Snorkle, where the same fault was
  found: in landscape, two-finger scrolls reached the web view turned a
  quarter round — a vertical swipe arrived as a horizontal one — so the
  continuous view, which only scrolls vertically, didn't move, while a
  finger scrolled it fine. `UIApplicationSupportsIndirectInputEvents`
  makes UIKit deliver the pointer natively, and a single-window
  `UIApplicationSceneManifest` naming `TaoSceneDelegate` puts Tao (0.37
  or later) on the scene lifecycle, so the window is created in its
  scene's orientation; without the manifest Tao starts on the legacy
  application-delegate path. Both are read from the built app, so a
  change to them needs a rebuild and reinstall, not a hot reload. The
  native plugins already find their windows through the scenes. To
  check on a device: in landscape and in portrait, launched in each,
  two fingers on the trackpad scroll the continuous view vertically and
  turn sets in the paged view; a finger still scrolls; the status bar
  still hides full screen and returns in a windowed layout.
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
