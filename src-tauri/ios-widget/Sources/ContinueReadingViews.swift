import SwiftUI
import UIKit
import WidgetKit

// The Continue Reading widgets' faces (ContinueReading.swift): the last
// PDF in a small widget, the last two side by side in a medium one, the
// last three stacked in a large one — as text, with a bar for how far
// through each one the page is, or (`withPages`) with the page itself.
// A small widget opens its PDF from anywhere on it; the larger ones,
// each PDF from its own part. Each PDF has a pin at its top right
// (PinButton): faint until it is pressed, then filled in the accent while
// it keeps the PDF in its place (ContinueReadingPins.swift) — beside the
// title, on the heading's line in a small widget, or on a disc over the
// page's corner on a page card.

/// The app's accent: its red, lighter in the dark.
let accent = Color(UIColor { traits in
  traits.userInterfaceStyle == .dark
    ? UIColor(red: 0.82, green: 0.35, blue: 0.31, alpha: 1)
    : UIColor(red: 0.66, green: 0.20, blue: 0.16, alpha: 1)
})

struct ContinueReadingView: View {
  @Environment(\.widgetFamily) private var family
  let entry: ReadingEntry
  let withPages: Bool

  var body: some View {
    let pdfs = Array(entry.pdfs.prefix(places(in: family)))
    content(pdfs)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .widgetBackground()
  }

  @ViewBuilder
  private func content(_ pdfs: [RecentPDF]) -> some View {
    if pdfs.isEmpty {
      EmptyShelf(problem: entry.problem)
    } else if family == .systemSmall {
      cell(pdfs[0])
        .widgetURL(pdfs[0].openURL)
        .overlay(alignment: .topTrailing) { pin(pdfs[0], at: 0) }
    } else if family == .systemMedium {
      VStack(alignment: .leading, spacing: 8) {
        if !withPages { Heading() }
        HStack(alignment: .top, spacing: 12) {
          ForEach(Array(pdfs.enumerated()), id: \.element.id) { i, pdf in
            // The pin over the link, not in it: a press there is the pin's.
            Link(destination: pdf.openURL) { cell(pdf) }
              .overlay(alignment: .topTrailing) { pin(pdf, at: i) }
          }
          // One PDF read so far: it keeps to its half.
          if pdfs.count == 1 { Spacer(minLength: 0).frame(maxWidth: .infinity) }
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 0) {
        Heading().padding(.bottom, 8)
        ForEach(Array(pdfs.enumerated()), id: \.element.id) { i, pdf in
          if i > 0 { Divider().padding(.vertical, 8) }
          Link(destination: pdf.openURL) { row(pdf) }
            .overlay(alignment: .topTrailing) { pin(pdf, at: i) }
        }
        Spacer(minLength: 0)
      }
    }
  }

  /// The pin of the PDF in place `i`: on a disc inside a page card's
  /// corner; else level with the title (the heading, in a small widget).
  private func pin(_ pdf: RecentPDF, at i: Int) -> some View {
    let onPage = withPages && family != .systemLarge
    return PinButton(attKey: pdf.attKey, slot: i, pinned: entry.pinned.contains(pdf.attKey), onPage: onPage)
      .offset(x: onPage ? -2 : 8, y: onPage ? 2 : -7)
  }

  /// A small widget's PDF, or one of a medium one's two.
  @ViewBuilder
  private func cell(_ pdf: RecentPDF) -> some View {
    if withPages {
      PageCard(pdf: pdf, image: entry.pages[pdf.attKey])
    } else {
      VStack(alignment: .leading, spacing: 0) {
        if family == .systemSmall { Heading().padding(.bottom, 6) }
        Text(pdf.title)
          .font(.system(size: 15, weight: .semibold))
          .lineLimit(3)
          .foregroundColor(.primary)
          // Clear of the pin, which a small widget has on the heading's line.
          .padding(.trailing, family == .systemSmall ? 0 : 16)
        Text(pdf.author)
          .font(.system(size: 12))
          .foregroundColor(.secondary)
          .lineLimit(1)
          .padding(.top, 2)
        Spacer(minLength: 6)
        PageProgress(pdf: pdf)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  /// One of a large widget's three.
  private func row(_ pdf: RecentPDF) -> some View {
    HStack(alignment: .top, spacing: 12) {
      if withPages {
        PageImage(image: entry.pages[pdf.attKey])
          .frame(width: 64, height: 84)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(pdf.title)
          .font(.system(size: 15, weight: .semibold))
          .lineLimit(2)
          .foregroundColor(.primary)
          .padding(.trailing, 16)
        Text(pdf.author)
          .font(.system(size: 12))
          .foregroundColor(.secondary)
          .lineLimit(1)
        Spacer(minLength: 4)
        PageProgress(pdf: pdf)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// "Continue reading", over the PDFs.
private struct Heading: View {
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "book")
      Text("Continue reading")
    }
    .font(.system(size: 11, weight: .semibold))
    .foregroundColor(accent)
  }
}

/// The page it was left on, and how far through the PDF that is.
private struct PageProgress: View {
  let pdf: RecentPDF

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(pdf.pageText)
        .font(.system(size: 11, weight: .medium))
        .foregroundColor(.secondary)
        .monospacedDigit()
      if let progress = pdf.progress {
        GeometryReader { geo in
          ZStack(alignment: .leading) {
            Capsule().fill(Color.secondary.opacity(0.2))
            Capsule().fill(accent).frame(width: max(3, geo.size.width * progress))
          }
        }
        .frame(height: 3)
      }
    }
  }
}

/// The page as the app last drew it; a blank sheet until it has.
private struct PageImage: View {
  let image: UIImage?

  var body: some View {
    ZStack {
      if let image = image {
        Image(uiImage: image)
          .resizable()
          .aspectRatio(contentMode: .fill)
      } else {
        Color(UIColor.secondarySystemBackground)
        Image(systemName: "doc.text")
          .font(.system(size: 18))
          .foregroundColor(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .clipped()
    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 6, style: .continuous)
        .stroke(Color.secondary.opacity(0.25), lineWidth: 0.5)
    )
  }
}

/// A small or medium page widget's PDF: the page, its top in view, with
/// the title and page over its foot.
private struct PageCard: View {
  let pdf: RecentPDF
  let image: UIImage?

  var body: some View {
    PageImage(image: image)
      .overlay(alignment: .bottomLeading) {
        VStack(alignment: .leading, spacing: 1) {
          Text(pdf.title)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(2)
          Text(pdf.pageText)
            .font(.system(size: 10, weight: .medium))
            .opacity(0.85)
            .monospacedDigit()
        }
        .foregroundColor(.white)
        .padding(.horizontal, 8)
        .padding(.top, 18)
        .padding(.bottom, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          LinearGradient(colors: [.black.opacity(0), .black.opacity(0.72)], startPoint: .top, endPoint: .bottom)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
      }
  }
}

/// The pin beside a PDF (TogglePin): faint until pressed, then filled in
/// the accent while it keeps the PDF in its place; pressed again, it lets
/// it go. Over a page it sits on a disc of the widget's ground, so it
/// shows on any page.
struct PinButton: View {
  let attKey: String
  let slot: Int
  let pinned: Bool
  var onPage = false

  var body: some View {
    Button(intent: TogglePin(attKey: attKey, slot: slot)) {
      Image(systemName: pinned ? "pin.fill" : "pin")
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(pinned ? accent : Color.secondary.opacity(onPage ? 1 : 0.6))
        .frame(width: 22, height: 22)
        .background {
          if onPage { Circle().fill(Color(UIColor.systemBackground).opacity(0.88)) }
        }
        // A press a little short of it still counts.
        .frame(width: 30, height: 30)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(pinned ? "Unpin" : "Pin in this place")
  }
}

/// Nothing read yet — or, with a problem, why there is nothing to show.
private struct EmptyShelf: View {
  let problem: ShelfProblem?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Heading()
      Text(problem?.text ?? "Open a PDF in Zotero Helper and it will be here, at the page you leave it on.")
        .font(.system(size: 12))
        .foregroundColor(.secondary)
        .minimumScaleFactor(0.8)
    }
  }
}

extension View {
  /// A widget's background, given through its container (iOS 17), which
  /// gives it its margins too.
  func widgetBackground() -> some View {
    containerBackground(for: .widget) { Color(UIColor.systemBackground) }
  }
}
