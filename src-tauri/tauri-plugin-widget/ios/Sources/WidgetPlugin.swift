import SwiftRs
import Tauri
import UIKit
import WebKit
import WidgetKit

// The Continue Reading widget's data (src-tauri/ios-widget/), written
// where the widget can read it: the app group the app and the widget
// extension share (`group.com.laffan.zoterohelper`, in both their
// entitlements — scripts/ios-widget.mjs). A widget runs in a process of
// its own and can't ask the app anything; it reads what is there when
// WidgetKit asks it for a timeline.
//
// `update` is handed the PDFs read last, newest first (title, author,
// the page each was left on, its page count) and thumbnails of those
// pages, as JPEG, for the PDFs whose page has been drawn again since the
// last update. Each thumbnail is kept as `widget/<attKey>.jpg`, the
// list as `widget/recent.json`; thumbnails of PDFs no longer listed are
// let go. Then the widgets are drawn again — which, done while the app is
// in front, doesn't count against WidgetKit's budget of reloads.

let appGroup = "group.com.laffan.zoterohelper"

class WidgetPlugin: Plugin {
  struct Entry: Codable {
    let itemKey: String
    let attKey: String
    let title: String
    let author: String
    let page: Int
    let pageCount: Int?
    let openedMs: Double
  }

  struct UpdateArgs: Decodable {
    let entries: [Entry]
    let thumbnails: [String: String]
  }

  struct RecentFile: Encodable {
    let entries: [Entry]
  }

  /// Zotero's keys are letters and digits: nothing else names a file.
  private func isKey(_ s: String) -> Bool {
    !s.isEmpty && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
  }

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)
    guard
      let dir = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
        .appendingPathComponent("widget", isDirectory: true)
    else {
      invoke.reject("The app group \(appGroup) isn't available: the App Groups capability is missing")
      return
    }
    let files = FileManager.default
    try files.createDirectory(at: dir, withIntermediateDirectories: true)
    for (attKey, base64) in args.thumbnails where isKey(attKey) {
      guard let data = Data(base64Encoded: base64) else { continue }
      try data.write(to: dir.appendingPathComponent("\(attKey).jpg"), options: .atomic)
    }
    let entries = args.entries.filter { isKey($0.attKey) && isKey($0.itemKey) }
    let keep = Set(entries.map { "\($0.attKey).jpg" })
    for name in (try? files.contentsOfDirectory(atPath: dir.path)) ?? []
    where name.hasSuffix(".jpg") && !keep.contains(name) {
      try? files.removeItem(at: dir.appendingPathComponent(name))
    }
    let json = try JSONEncoder().encode(RecentFile(entries: entries))
    try json.write(to: dir.appendingPathComponent("recent.json"), options: .atomic)
    WidgetCenter.shared.reloadAllTimelines()
    invoke.resolve()
  }
}

@_cdecl("init_plugin_widget")
func initPlugin() -> Plugin {
  return WidgetPlugin()
}
