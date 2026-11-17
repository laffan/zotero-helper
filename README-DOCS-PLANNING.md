# Zotero Helper docs: planning

A plan for the GitHub Pages documentation. It decides what the docs
should spend their effort on, not how the site looks. Nothing here is
built yet.

The rule behind it: a reader who already uses Zotero, Acrobat, Preview
or PDF Expert does not need a page explaining highlights or a library
sidebar. The docs earn their keep on the things Zotero Helper does that
those apps don't, so those get the pages, the screenshots and the
GIFs, and the standard parts get a line each.

Sources for this plan: `README.md`, `README_DETAIL.md`, the Features,
Settings and Keyboard shortcuts sections of `README_TECHNICAL.md`, the
commit history to v0.2.0, and the v0.2.0 release notes. The baseline
of what other apps do is at the end, with links.

## Pitch

Draft, for the home page:

> Zotero Helper is a reading app for your Zotero library, built for the
> iPad and the Apple Pencil. Everything you mark goes back to Zotero as
> ordinary annotations, so nothing is locked in. Around that it adds
> what a reader of papers actually wants: post-its you can write on, a
> map of your highlights by chapter and section, a notepad that links
> back into the pages, sections you draw yourself, and, if you bring an
> AI key, answers about your papers whose page citations you can check
> in one tap.

One line for the top of every page: *A Pencil-first reader for Zotero:
everything you mark is a Zotero annotation.*

Positioning to state plainly on the home page: it is a companion to
Zotero, not a replacement. It does not format citations or
bibliographies, and it needs a Zotero account and API key.

## Distinctive features, ranked

Ranked by how far each sets the app apart from a typical PDF reader or
citation manager. Tier 1 has, as far as I could find, no direct
equivalent in the genre. Tier 2 has a precedent in a niche app
(usually LiquidText or MarginNote) but not in Zotero or a mainstream
PDF reader, and is unusual here because it is built on top of Zotero's
own data. Tier 3 is small touches that are worth a section on a
broader page rather than a page of their own.

### Tier 1

**1. Post-its that round-trip to Zotero**

- *What it is:* a square of coloured paper stuck on a page, written on
  with the Pencil or typed on. It can be pared down by dragging its
  corners to a sliver that sits beside the text or at the page edge,
  and opens whole with a tap. Post-its have their own tab, show in the
  thumbnails, folded view and notepad clips.
- *Why it's unusual:* sticky notes in other readers are an icon with a
  popup. These are paper you write on that stays readable on the page.
  Zotero has no post-it type, so each is saved as Zotero's nearest
  native parts (a text annotation for the words, an ink annotation for
  the writing), which means Zotero desktop, iOS and web show them too.
- *Page needs:* a GIF of placing one, writing on it and paring it down
  by a corner; a still of the same page in Zotero desktop showing the
  text and ink arrive; the Post-its tab. A short "what Zotero sees"
  note. The known gaps from the technical guide (no undo for writing,
  can't enlarge, can't move to another page, rotated pages) belong in
  a "Limits" box.

**2. AI answers with page citations you can check**

- *What it is:* Ask About sends the abstract, the full text, a section,
  a page range or the pages in view to Anthropic or OpenAI with your
  own key. Answers cite pages and quote the passage. A tap on "See on
  p. 12" opens the PDF, finds the quoted words in the document and
  marks them in a colour no highlight uses. If the words aren't in the
  PDF, nothing is marked, so an unverified citation doesn't look
  verified.
- *Why it's unusual:* Zotero has no AI features of its own, and AI
  in other readers (LiquidText's Ask AI, for example) is a paid add-on
  I haven't been able to check in detail, so this ranking is a
  judgement. What stands out is that this one locates the quoted text itself and trusts the quote over the
  page number, which is the part models get wrong most. Also unusual: the cost is shown before anything is sent,
  and a countdown shows how long the provider's prompt cache keeps the
  papers cheap.
- *Page needs:* a GIF from a question to the pink-marked passage; a
  still of the cost popup and the cache countdown; a plain section on
  what is sent (words, never the PDF; nothing about Zotero) and what it
  costs. One page for Ask About, with Clarifications and the explainer
  as its sub-pages or sections (see 7 and 8).

**3. Capture browser and learned PDF locations**

- *What it is:* when an automatic PDF download is blocked, the item
  waits under "PDF needs your help" and a built-in browser opens on the
  publisher's page; whatever PDF you reach there is attached to the
  Zotero item. Each PDF that works teaches the app where that publisher
  keeps its files, and every other item waiting on the same publisher
  is retried with that pattern. Fetching for existing items finds a
  missing DOI first and writes it back.
- *Why it's unusual:* Zotero and the Zotero iOS app already add items
  by DOI and fetch open-access PDFs, so "import DOIs with PDFs" on its
  own is no longer distinctive (the current README still leads with
  it). The hand-rescue browser, the learned patterns and the batch
  retry are what nobody else does.
- *Page needs:* a GIF of one rescue in the capture browser followed by
  the rest of the batch clearing; a diagram of the pipeline (resolve,
  create, find PDF, download, upload) with where a rescue cuts in; a
  note on the polite rate limits so readers know why it's slow at some
  sites.

### Tier 2

**4. Highlight Map**

- *What it is:* widen the notes panel past about 600px and the
  Highlights tab becomes a canvas that pans and zooms, with a row per
  chapter and a column per section, the highlights as cards. Search and
  colour filters fade the rest. The notepad can open over it, and its
  links can point at cards.
- *Why it's unusual:* MarginNote builds a mind map from a book's table
  of contents; nothing in Zotero or a mainstream reader lays out
  highlights by structure. Here it is built from Zotero's own
  highlights plus the sections you draw (5), so it works on any PDF.
- *Page needs:* a GIF of widening the panel into the map, then a pinch
  and a search; a still of a book-length PDF's map; a sentence on how
  rows and columns are chosen (top-level outline headings and anything
  named "Chapter").

**5. Add Section**

- *What it is:* draw a named dashed line across a page to divide your
  highlights. Sections sit among the PDF's own outline headings, or
  stand alone when the PDF has no outline, and feed the Highlights tab
  and the map.
- *Why it's unusual:* readers show the outline the PDF ships with, and
  many papers have none or a wrong one. Letting the reader impose
  structure on highlights is rare.
- *Page needs:* a short GIF of drawing and naming a section, then the
  Highlights tab regrouping. Could share a page with the map (4), since
  each makes the other's case.

**6. The notepad**

- *What it is:* a Pencil scratchpad per PDF, in reading mode or under
  the notes. Writing done on one page is grouped as one note and
  remembers where in the PDF it began. A quote button drags a link from
  the pad onto a highlight, a spot on a page or a map card; scissors
  clip part of a page onto the pad; quotes and clips can be pinned
  under the ink and written over. Double-tap to type a Markdown note.
  With two pages side by side, auto-shift moves the pad to the facing
  page. A minimap shows the whole pad.
- *Why it's unusual:* LiquidText has the closest idea (excerpts on a
  canvas, linked back to the source). Zotero and mainstream readers
  have nothing like it. Here the pad is tied to one PDF and its Zotero
  highlights, and follows the reader through the document.
- *Page needs:* the most media of any page: a GIF each for writing
  then turning the page (a new note starts), dragging a quote link
  onto a highlight, clipping and pinning, and the double-tap text note.
  Probably its own page with short sections rather than one long one.

**7. Clarifications**

- *What it is:* select a passage of any AI answer and ask about it; the
  answer opens in a column beside it, level with the passage, which
  stays marked. Clarifications nest, and each can carry on as its own
  thread.
- *Why it's unusual:* chat interfaces answer follow-ups below; this
  keeps the main answer intact and puts the side question beside the
  words it is about.
- *Page needs:* a still of two levels of columns; a GIF of one
  selection opening a column. A section of the Ask About page.

**8. Explanations and Words, kept and underlined**

- *What it is:* explain a selected passage or highlight (with no
  context, or with the work as context) or define a word; each answer
  is kept in an Explanations or Words list and the passage is
  underlined in the pages so you can find it again. The prompts are
  editable templates.
- *Why it's unusual:* look-up in readers is a throwaway popup; here it
  becomes a record attached to the place in the text.
- *Page needs:* a still of an underlined passage with its explanation;
  a still of the Prompts editor. A section of the Ask About page.

**9. Markdown reading notes that live in Zotero**

- *What it is:* every entry has a `NOTES.md` beside the PDF, rendered
  in place as you type, synced to Zotero as an attachment. Quoting a
  highlight inserts a link back to its page; page links show as small
  pills in the highlight's colour; a link icon at the start of a line
  can be dragged onto a highlight or a map card to cite it. An empty
  note offers a set of reading questions to start from.
- *Why it's unusual:* Zotero's notes are rich text in its own format;
  a plain Markdown file that travels with the item, with live page
  pills, is closer to Obsidian than to Zotero.
- *Page needs:* a still of a note with pills; a GIF of dragging the
  line's link icon onto a highlight. A note on the conflict rule (both
  versions kept, local wins).

**10. Continue Reading widgets (iOS)**

- *What it is:* home-screen widgets with the last PDFs read, as text
  with progress, or as the page itself with your highlights and ink on
  it. A tap opens the PDF at that page.
- *Why it's unusual:* Zotero iOS has a Recently Read collection, not a
  widget that shows the page with your marks.
- *Page needs:* a still of each widget size. Short page, or a section
  of an iPad page. Says clearly that iOS builds aren't in the release
  downloads and need a self-build (see open questions).

### Tier 3: sections on broader pages

These belong on a "Reading" page, a "Library" page or an "iPad" page,
a paragraph and a still or short GIF each.

- **Folded view:** collapses the paper to the regions around its
  annotations, keeping your place in and out. (Shared with Hush, so the
  two sites could share the explanation.)
- **Trimmed reading:** hold Control over the pages to drag the margins
  in, then read without them.
- **Four- and five-page spreads**, paged or continuous, in either
  direction, with each page shown at its own size.
- **Reading clock and timer:** progress, page and time beside the page
  number, and a For or Until timer that alerts at zero.
- **Sentence selection:** ⌘-click or the sentence tool selects a whole
  sentence; highlights can cross a page break and their ends can be
  dragged.
- **Sharing part of a PDF:** visible pages, a page range or an outline
  section as a new PDF that keeps its text, named after the part.
- **Every PDF reopens as left:** layout, zoom, folded view, panels, map
  pan and zoom, outline state, search on its match, notes caret.
- **Folder views:** pinned items in a dragged order, an icon view of
  first pages with their annotations, flagged folders, emoji tags shown
  as their glyph, PDF and abstract markers per item.
- **AI Tidy Metadata and Get Abstract.**
- **Send to Hush:** the link to Nate's writing app, for readers who use
  both.
- **iPad details:** full screen hides the status bar; tooltips on press
  and hold; the hardware keyboard handled properly.

## Standard features: a brief mention only

One line each, on the home page or the page they belong to, with no
screenshots of their own unless they appear in another feature's.

- Library browsing: collections, items, editable metadata, multi-select.
- Sync with the Zotero Web API, incremental or full, resumable on bad
  Wi-Fi.
- Search across metadata, with modes for titles, authors, publication
  and a year range.
- Highlights and underlines in Zotero's eight colours, comments, and
  Apple Pencil ink, all as standard Zotero annotations.
- Find in the PDF, outline, thumbnail grid, bookmarks, zoom and pinch.
- Light, dark and system themes; dark pages.
- Rebindable keyboard shortcuts, with a reference table on the setup
  page.
- Dragging items into collections; sharing PDFs and a Markdown list of
  titles and abstracts.
- Desktop builds for macOS, Windows and Linux.

## Proposed site structure

Ten pages, with the media budget going to pages 2 to 6.

1. **Home:** pitch, a hero GIF (post-it or citation check), what it is
   and isn't, a grid of the distinctive features linking to their
   pages, download links.
2. **Post-its**
3. **Ask About** (citations, clarifications, explanations and words,
   costs and privacy)
4. **Highlight Map and sections**
5. **The notepad**
6. **Rescuing PDFs** (capture browser and learned locations; also the
   ordinary import, briefly)
7. **Reading** (the Tier 3 reading features, notes in Markdown,
   standard reader features in one list)
8. **Library** (folder views, search, sync, sharing, Send to Hush)
9. **iPad and iOS** (Pencil, full screen, widgets, how to build for
   the device)
10. **Setup and reference** (install, Zotero API key, AI key and
    models, keyboard shortcuts table, where data is kept)

`README_TECHNICAL.md` stays in the repo as the contributor and
architecture document; the site links to it rather than copying it.

## Media to capture

All of these are best recorded on an iPad with the Pencil, since that
is the app's main case. A desktop recording works for the citation
check, the capture browser and the map.

| Page | Media |
| --- | --- |
| Home | 1 hero GIF |
| Post-its | 1 GIF, 2 stills (one in Zotero desktop) |
| Ask About | 2 GIFs, 3 stills |
| Map and sections | 2 GIFs, 1 still |
| Notepad | 4 GIFs |
| Rescuing PDFs | 1 GIF, 1 diagram |
| Reading, Library, iPad | about 1 still or short GIF per Tier 3 item |

A sample library of open-access papers would let every recording use
the same few documents without showing Nate's own library.

## Open questions for Nate

1. **Audience:** is this for you and a few colleagues, or for the
   public? That decides how much setup help (API keys, unsigned builds)
   the docs carry.
2. **iOS builds:** the release notes say iOS builds aren't among the
   downloads. Should the docs present the iPad as the main platform
   anyway, with self-build steps, or lead with desktop until there is a
   TestFlight or App Store build?
3. **Lead feature:** the README leads with importing DOIs with their
   PDFs, but the Zotero iOS app now does that too. Are you happy to
   lead with post-its and checkable citations instead, and describe
   import through the rescue browser?
4. **AI on the site:** the AI features are hidden until a key is
   entered. Should the docs treat them as optional extras on one page,
   or as a headline? And should model names and prices go on the site,
   given they will date?
5. **Shared look with the other apps:** Hush, Earbud and Idlewild are
   getting docs too. One shared theme and tooling across all four
   (for example Jekyll or MkDocs Material), or each on its own?
6. **Where the site lives:** a `docs/` folder on `main`, or a
   `gh-pages` branch?
7. **Screenshots:** will you record them on your iPad, or should I
   prepare a sample library and a shot list for you to work through?
8. **Hush cross-links:** the folded view and the highlight pane are
   ports from Hush. Link to Hush's docs for those, or explain them in
   full here?

## Baseline used for the ranking

What the comparison apps do, as checked on 2026-11-17:

- Zotero for iOS adds items by DOI or barcode with the camera, downloads
  article PDFs automatically, and annotates with highlights, underlines,
  text notes and Apple Pencil ink
  ([App Store listing](https://apps.apple.com/gb/app/zotero/id1513554812)).
- Zotero 8 adds annotations in the items list, reader themes, and an
  appearance panel for spreads and split view; it has no AI features
  ([Zotero 8 announcement](https://www.zotero.org/blog/zotero-8/)).
- LiquidText puts excerpts on a canvas, each linked to its source text,
  and has a paid Ask AI; MarginNote 4 builds a mind map from a book's
  table of contents
  ([Paperlike comparison](https://paperlike.com/blogs/paperlikers-insights/liquidtext-vs-marginnote)).
