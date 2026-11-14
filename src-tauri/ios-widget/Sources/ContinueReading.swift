import SwiftUI
import UIKit
import WidgetKit

// Continue Reading: the iOS home-screen widgets that pick up where the
// reader left off — the PDFs read last, newest first, each with its
// title, author and the page it was left on. Two widgets, each in three
// sizes: small shows the last PDF, medium the last two side by side,
// large the last three stacked.
//
// - "Continue Reading" shows them as text, with how far through each
//   one the page is.
// - "Continue Reading — Page" shows the page itself, as the app last
//   drew it: the reader's highlights and ink on it.
//
// A widget runs apart from the app and can't ask it anything: the app
// writes the list and the pages' thumbnails into the app group both
// share (tauri-plugin-widget's WidgetPlugin.swift: `widget/recent.json`,
// `widget/<attKey>.jpg`) and has the widgets drawn again as it does, so
// the timeline here is one entry that never expires by itself. A tap on
// a PDF opens the app on it, at its page
// (zoterohelper://open?item=…&att=…&page=…, which the app's page turns
// into opening the reader).
//
// Built as an app extension added to the Xcode project Tauri generates
// (scripts/ios-widget.mjs).

let appGroup = "group.com.laffan.zoterohelper"

/// One PDF read, as the app writes it.
struct RecentPDF: Codable, Hashable, Identifiable {
  let itemKey: String
  let attKey: String
  let title: String
  let author: String
  let page: Int
  let pageCount: Int?
  let openedMs: Double

  var id: String { attKey }

  /// The link that opens the app on it, at its page.
  var openURL: URL {
    var c = URLComponents()
    c.scheme = "zoterohelper"
    c.host = "open"
    c.queryItems = [
      URLQueryItem(name: "item", value: itemKey),
      URLQueryItem(name: "att", value: attKey),
      URLQueryItem(name: "page", value: String(page)),
    ]
    return c.url ?? URL(string: "zoterohelper://open")!
  }

  /// "p. 12 of 30", or "p. 12" when the count isn't known.
  var pageText: String {
    if let n = pageCount, n > 0 { return "p. \(page) of \(n)" }
    return "p. \(page)"
  }

  /// How far through it the page is, 0–1; nil when the count isn't known.
  var progress: Double? {
    guard let n = pageCount, n > 0 else { return nil }
    return min(1, max(0, Double(page) / Double(n)))
  }
}

private struct RecentFile: Decodable {
  let entries: [RecentPDF]
}

struct ReadingEntry: TimelineEntry {
  let date: Date
  let pdfs: [RecentPDF]
  /// Each PDF's page, by attKey (the page widget's only).
  let pages: [String: UIImage]

  static let sample = ReadingEntry(
    date: Date(),
    pdfs: [
      RecentPDF(itemKey: "A", attKey: "A1", title: "Close Reading and Its Discontents", author: "Reader", page: 12, pageCount: 30, openedMs: 0),
      RecentPDF(itemKey: "B", attKey: "B1", title: "The Archive and the Margin", author: "Marsh and Ellery", page: 41, pageCount: 212, openedMs: 0),
      RecentPDF(itemKey: "C", attKey: "C1", title: "Notes Toward a Theory of Annotation", author: "Okafor et al.", page: 3, pageCount: 18, openedMs: 0),
    ],
    pages: [:]
  )
}

/// What the app has written for the widgets.
enum Shelf {
  static var folder: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("widget", isDirectory: true)
  }

  static func read(withPages: Bool) -> ReadingEntry {
    guard
      let folder = folder,
      let data = try? Data(contentsOf: folder.appendingPathComponent("recent.json")),
      let file = try? JSONDecoder().decode(RecentFile.self, from: data)
    else {
      return ReadingEntry(date: Date(), pdfs: [], pages: [:])
    }
    let pdfs = Array(file.entries.prefix(3))
    var pages: [String: UIImage] = [:]
    if withPages {
      for pdf in pdfs {
        let path = folder.appendingPathComponent("\(pdf.attKey).jpg").path
        if let image = UIImage(contentsOfFile: path) { pages[pdf.attKey] = image }
      }
    }
    return ReadingEntry(date: Date(), pdfs: pdfs, pages: pages)
  }
}

struct Provider: TimelineProvider {
  /// The page widget reads the pages' thumbnails too.
  let withPages: Bool

  func placeholder(in context: Context) -> ReadingEntry { .sample }

  func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
    let entry = Shelf.read(withPages: withPages)
    // The widget gallery shows a sample until something has been read.
    completion(context.isPreview && entry.pdfs.isEmpty ? .sample : entry)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
    // The app has the widgets drawn again whenever what they show changes.
    completion(Timeline(entries: [Shelf.read(withPages: withPages)], policy: .never))
  }
}

struct ContinueReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ContinueReading", provider: Provider(withPages: false)) { entry in
      ContinueReadingView(entry: entry, withPages: false)
    }
    .configurationDisplayName("Continue Reading")
    .description("The PDFs you read last, each with the page you left it on.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct ContinueReadingPageWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ContinueReadingPage", provider: Provider(withPages: true)) { entry in
      ContinueReadingView(entry: entry, withPages: true)
    }
    .configurationDisplayName("Continue Reading — Page")
    .description("The page you left each PDF on, with your highlights and ink.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct ZoteroHelperWidgets: WidgetBundle {
  var body: some Widget {
    ContinueReadingWidget()
    ContinueReadingPageWidget()
  }
}
