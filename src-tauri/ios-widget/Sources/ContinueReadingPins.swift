import AppIntents
import Foundation
import WidgetKit

// Pins: a PDF kept in its place in the Continue Reading widgets however
// many are read after it. The pin beside each PDF on a widget
// (ContinueReadingViews.swift's PinButton) runs TogglePin, in the
// widget's own process (an interactive widget): the PDF is
// pinned to the place it is in — the first, second or third — or, if it
// is pinned already, let go. Every place can be pinned; the places not
// pinned are filled with the PDFs read last, newest first.
//
// Pins belong to the widgets, not to one of them: kept in the app group
// beside what the app writes (`widget/pins.json`), so every Continue
// Reading widget — text or page, any size — keeps the same PDF in the
// same place (a place a widget doesn't have, such as the second on a
// small one, is not shown there). A widget can't tell which copy of it
// was tapped, so pins can't be one widget's own. Pinning a PDF to a place
// another pin held takes the place over.
//
// The app never changes the pins. It writes the whole of Recent for the
// widgets to choose from (the page's lib/widget.ts), so a pinned PDF can
// be shown however long ago it was read, and keeps the pinned PDFs' page
// pictures (tauri-plugin-widget's WidgetPlugin.swift reads this file).

/// A PDF kept in a place.
struct Pin: Codable, Hashable {
  let attKey: String
  /// 0: the first place (a small widget's, a medium one's left); 1, 2.
  let slot: Int
}

private struct PinFile: Codable {
  var pins: [Pin]
}

enum Pins {
  static var file: URL? { Shelf.folder?.appendingPathComponent("pins.json") }

  static func read() -> [Pin] {
    guard
      let file = file,
      let data = try? Data(contentsOf: file),
      let decoded = try? JSONDecoder().decode(PinFile.self, from: data)
    else { return [] }
    return decoded.pins
  }

  /// Pin `attKey` to place `slot`, taking it from any other pin there —
  /// or, pinned already, let it go.
  static func toggle(attKey: String, slot: Int) throws {
    guard let file = file else { return }
    var pins = read()
    if pins.contains(where: { $0.attKey == attKey }) {
      pins.removeAll { $0.attKey == attKey }
    } else {
      pins.removeAll { $0.slot == slot }
      pins.append(Pin(attKey: attKey, slot: slot))
    }
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(PinFile(pins: pins)).write(to: file, options: .atomic)
  }
}

extension Shelf {
  /// What a widget with `slots` places shows: each pinned PDF in its
  /// place, the other places filled with the PDFs read last (`recent`,
  /// newest first), none twice. With fewer PDFs than places they close
  /// up, in order.
  static func arrange(_ recent: [RecentPDF], pins: [Pin], slots: Int) -> [RecentPDF] {
    var byKey: [String: RecentPDF] = [:]
    for pdf in recent where byKey[pdf.attKey] == nil { byKey[pdf.attKey] = pdf }
    var places = [RecentPDF?](repeating: nil, count: slots)
    var used = Set<String>()
    for pin in pins where pin.slot >= 0 && pin.slot < slots && places[pin.slot] == nil {
      guard let pdf = byKey[pin.attKey], used.insert(pdf.attKey).inserted else { continue }
      places[pin.slot] = pdf
    }
    var latest = recent.makeIterator()
    for i in 0..<slots where places[i] == nil {
      while let pdf = latest.next() {
        if used.insert(pdf.attKey).inserted {
          places[i] = pdf
          break
        }
      }
    }
    return places.compactMap { $0 }
  }
}

/// The pin beside a PDF, pressed.
struct TogglePin: AppIntent {
  static var title: LocalizedStringResource = "Pin or Unpin a PDF"
  /// Only the widget's own pins run it: it isn't offered in Shortcuts.
  static var isDiscoverable: Bool = false

  @Parameter(title: "Attachment") var attKey: String
  @Parameter(title: "Place") var slot: Int

  init() {}

  init(attKey: String, slot: Int) {
    self.attKey = attKey
    self.slot = slot
  }

  func perform() async throws -> some IntentResult {
    try Pins.toggle(attKey: attKey, slot: slot)
    // WidgetKit draws the widget tapped again; the others show the pins too.
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}
