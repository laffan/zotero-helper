import SwiftUI
import UIKit
import WidgetKit

// The Continue Reading widgets' faces (ContinueReading.swift): the last
// PDF in a small widget, the last two side by side in a medium one, the
// last three stacked in a large one — as text, with a bar for how far
// through each one the page is, or (`withPages`) with the page itself.
// A small widget opens its PDF from anywhere on it; the larger ones,
// each PDF from its own part.

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

  private var count: Int {
    switch family {
    case .systemSmall: return 1
    case .systemMedium: return 2
    default: return 3
    }
  }

  var body: some View {
    let pdfs = Array(entry.pdfs.prefix(count))
    content(pdfs)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .legacyMargins()
      .widgetBackground()
  }

  @ViewBuilder
  private func content(_ pdfs: [RecentPDF]) -> some View {
    if pdfs.isEmpty {
      EmptyShelf(problem: entry.problem)
    } else if family == .systemSmall {
      cell(pdfs[0]).widgetURL(pdfs[0].openURL)
    } else if family == .systemMedium {
      VStack(alignment: .leading, spacing: 8) {
        if !withPages { Heading() }
        HStack(alignment: .top, spacing: 12) {
          ForEach(pdfs) { pdf in
            Link(destination: pdf.openURL) { cell(pdf) }
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
        }
        Spacer(minLength: 0)
      }
    }
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
  /// iOS 17 gives a widget its background through the container, and
  /// margins of its own; before it, the view brings both.
  @ViewBuilder
  func widgetBackground() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color(UIColor.systemBackground) }
    } else {
      background(Color(UIColor.systemBackground))
    }
  }

  @ViewBuilder
  func legacyMargins() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self
    } else {
      padding(16)
    }
  }
}
